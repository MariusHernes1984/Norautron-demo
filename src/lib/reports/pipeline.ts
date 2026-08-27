import { z } from "zod";
import { KPI_TOPICS } from "../constants";
import { getActiveDatasetVersion } from "../db/dataset";
import { DEPLOYMENT, streamModelEvents, type ModelEvent } from "../model";
import type {
  KpiTopicId,
  ReportClaim,
  ReportDocument,
  ReportSection,
  ReportSpec
} from "../types";
import { verifyTopicKpis } from "./fact-spec";
import { loadReportFacts, type TopicFacts } from "./facts";

const claimSchema = z.object({
  text: z.string().trim().min(1).max(800),
  factIds: z.array(z.string().trim().min(1).max(100)).min(1).max(8)
}).strict();

const modelReportSchema = z.object({
  title: z.string().trim().min(1).max(120),
  subtitle: z.string().trim().min(1).max(200),
  executiveSummary: z.array(claimSchema).min(1).max(6),
  sections: z.array(
    z.object({
      topic: z.string().trim().min(1).max(40),
      title: z.string().trim().min(1).max(120),
      claims: z.array(claimSchema).min(1).max(8)
    }).strict()
  ).min(1).max(6),
  risks: z.array(claimSchema).max(8).default([]),
  actions: z.array(claimSchema).max(8).default([]),
  methodology: z.string().trim().max(1000).optional()
}).strict();

type ModelReport = z.infer<typeof modelReportSchema>;

const SYSTEM_PROMPT = `Du skriver en kort lederrapport fra en lukket liste med verifiserte fakta.
Returner kun gyldig JSON med denne formen:
{
  "title": "...",
  "subtitle": "...",
  "executiveSummary": [{"text":"...","factIds":["sales-total"]}],
  "sections": [
    {
      "topic":"sales",
      "title":"...",
      "claims":[{"text":"...","factIds":["sales-total"]}]
    }
  ],
  "risks": [{"text":"...","factIds":["supply-delay"]}],
  "actions": [{"text":"...","factIds":["quality-rate"]}],
  "methodology": "..."
}

Ufravikelige regler:
- FACTS er hele kunnskapsgrunnlaget. Ikke bruk generell kunnskap, antakelser,
  prognoser eller tall som ikke står i FACTS.
- Hver påstand skal være ett eget claim og sitere minst én relevant factId.
- Siter bare factId-er som finnes i FACTS. Kopier tall nøyaktig.
- Skill observasjoner, risiko og tiltak. Tiltak skal formuleres som forslag.
- Returner nøyaktig én section per valgt topic, med samme topic-id.
- Skriv på ønsket språk, konkret og konsist for valgt målgruppe.
- Ikke inkluder markdown eller kodegjerder.`;

type CompactRow = {
  factId: string;
  values: Record<string, string | number | boolean | null>;
};

type CompactTopic = {
  topic: KpiTopicId;
  label: string;
  kpis: Array<{
    factId: string;
    label: string;
    value: number;
    formatted: string;
  }>;
  rows: CompactRow[];
};

function boundedFactValue(value: unknown) {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value).slice(0, 200);
}

export function compactFactsForModel(facts: TopicFacts[]) {
  const compact: CompactTopic[] = facts.map((fact) => ({
    topic: fact.topic,
    label: fact.label,
    kpis: fact.kpis.map((item) => ({
      factId: item.id,
      label: item.label,
      value: item.value,
      formatted: item.formatted
    })),
    rows: []
  }));
  let characters = JSON.stringify(compact).length;

  outer: for (const [index, fact] of facts.entries()) {
    for (const [rowIndex, row] of fact.rows.slice(0, 12).entries()) {
      const bounded = Object.fromEntries(
        Object.entries(row)
          .slice(0, 20)
          .map(([key, value]) => [key, boundedFactValue(value)])
      );
      const modelRow: CompactRow = {
        factId: `${fact.topic}:row:${rowIndex + 1}`,
        values: bounded
      };
      const rowCharacters = JSON.stringify(modelRow).length + 1;
      if (characters + rowCharacters > 48_000) break outer;
      compact[index].rows.push(modelRow);
      characters += rowCharacters;
    }
  }
  return compact;
}

function parseModelReport(text: string): ModelReport | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    const result = modelReportSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function numericTokens(value: unknown) {
  const matches = String(value).match(
    /-?\d+(?:[ \u00a0.]\d{3})*(?:[,.]\d+)?/g
  );
  return new Set(
    (matches ?? []).map((token) => {
      const compact = token.replace(/[ \u00a0]/g, "");
      if (compact.includes(",") && compact.includes(".")) {
        return compact.lastIndexOf(",") > compact.lastIndexOf(".")
          ? compact.replace(/\./g, "").replace(",", ".")
          : compact.replace(/,/g, "");
      }
      return compact.replace(",", ".");
    })
  );
}

function buildGroundingIndex(facts: TopicFacts[]) {
  const idsByTopic = new Map<KpiTopicId, Set<string>>();
  const tokensByFactId = new Map<string, Set<string>>();
  for (const fact of compactFactsForModel(facts)) {
    const topicIds = new Set<string>();
    for (const kpi of fact.kpis) {
      topicIds.add(kpi.factId);
      tokensByFactId.set(
        kpi.factId,
        new Set([
          ...numericTokens(kpi.value),
          ...numericTokens(kpi.formatted)
        ])
      );
    }
    for (const row of fact.rows) {
      topicIds.add(row.factId);
      tokensByFactId.set(
        row.factId,
        new Set(
          Object.values(row.values).flatMap((value) => [
            ...numericTokens(value)
          ])
        )
      );
    }
    idsByTopic.set(fact.topic, topicIds);
  }
  return { idsByTopic, tokensByFactId };
}

function claimsAreGrounded(
  claims: ReportClaim[],
  allowedFactIds: ReadonlySet<string>,
  tokensByFactId: ReadonlyMap<string, ReadonlySet<string>>
) {
  return claims.every((claim) => {
    if (
      claim.factIds.length === 0 ||
      new Set(claim.factIds).size !== claim.factIds.length ||
      claim.factIds.some((factId) => !allowedFactIds.has(factId))
    ) {
      return false;
    }
    const allowedTokens = new Set(
      claim.factIds.flatMap((factId) => [
        ...(tokensByFactId.get(factId) ?? [])
      ])
    );
    return [...numericTokens(claim.text)].every((token) =>
      allowedTokens.has(token)
    );
  });
}

export function hydrateReport(input: {
  text: string;
  spec: ReportSpec;
  facts: TopicFacts[];
  datasetVersion: string;
  now?: () => Date;
}): ReportDocument | null {
  const model = parseModelReport(input.text);
  if (!model) return null;

  const selectedTopics = new Set(input.spec.topics);
  const modelTopics = model.sections.map((section) => section.topic);
  if (
    modelTopics.length !== selectedTopics.size ||
    new Set(modelTopics).size !== modelTopics.length ||
    modelTopics.some((topic) => !selectedTopics.has(topic as KpiTopicId))
  ) {
    return null;
  }

  const { idsByTopic, tokensByFactId } = buildGroundingIndex(input.facts);
  const allFactIds = new Set(
    [...idsByTopic.values()].flatMap((factIds) => [...factIds])
  );
  if (
    !claimsAreGrounded(model.executiveSummary, allFactIds, tokensByFactId) ||
    !claimsAreGrounded(model.risks, allFactIds, tokensByFactId) ||
    !claimsAreGrounded(model.actions, allFactIds, tokensByFactId)
  ) {
    return null;
  }

  const sections: ReportSection[] = [];
  for (const fact of input.facts) {
    const generated = model.sections.find(
      (section) => section.topic === fact.topic
    );
    const allowed = idsByTopic.get(fact.topic);
    if (
      !generated ||
      !allowed ||
      !claimsAreGrounded(generated.claims, allowed, tokensByFactId)
    ) {
      return null;
    }
    sections.push({
      topic: fact.topic,
      title: generated.title,
      claims: generated.claims,
      chart: fact.chart
    });
  }

  const checks = input.facts.flatMap((fact) =>
    verifyTopicKpis({
      topic: fact.topic,
      rows: fact.verificationRows,
      kpis: fact.kpis
    })
  );
  if (checks.length === 0 || checks.some((check) => !check.ok)) return null;

  const risks = input.spec.includeRisks ? model.risks : [];
  const actions = input.spec.includeActions ? model.actions : [];
  const totalClaims =
    model.executiveSummary.length +
    sections.reduce((total, section) => total + section.claims.length, 0) +
    risks.length +
    actions.length;
  const kpis = input.facts.flatMap((fact) => fact.kpis);
  return {
    title: input.spec.title?.trim() || model.title,
    subtitle: model.subtitle,
    executiveSummary: model.executiveSummary,
    kpis,
    sections,
    risks,
    actions,
    methodology: input.spec.includeMethodology
      ? model.methodology ||
        "KPI-ene er beregnet deterministisk fra aktiv datasetversjon."
      : undefined,
    datasetVersion: input.datasetVersion,
    modelDeployment: DEPLOYMENT,
    createdAt: (input.now?.() ?? new Date()).toISOString(),
    qa: {
      verified: checks.filter((check) => check.ok).length,
      total: checks.length,
      ok: true,
      groundedClaims: totalClaims,
      totalClaims,
      checks
    }
  };
}

export async function* reportPipeline(input: {
  requestId: string;
  spec: ReportSpec;
  release: () => Promise<void>;
  signal?: AbortSignal;
  onPrepared: (facts: TopicFacts[], datasetVersion: string) => void;
}): AsyncGenerator<ModelEvent> {
  try {
    input.signal?.throwIfAborted();
    yield { kind: "stage", stage: "schema" };
    const datasetVersion = await getActiveDatasetVersion();
    input.signal?.throwIfAborted();
    yield { kind: "stage", stage: "query" };
    const facts = await loadReportFacts(input.spec.topics, input.spec);
    input.signal?.throwIfAborted();
    input.onPrepared(facts, datasetVersion);

    const compactFacts = compactFactsForModel(facts);
    const topicLabels = input.spec.topics.map(
      (id) => KPI_TOPICS.find((topic) => topic.id === id)?.label ?? id
    );
    const appliedFilters = {
      periodFrom: input.spec.periodFrom ?? null,
      periodTo: input.spec.periodTo ?? null,
      ...input.spec.filters
    };

    yield { kind: "stage", stage: "compose" };
    for await (const event of streamModelEvents({
      operation: "report.compose",
      requestId: input.requestId,
      responseJson: true,
      reasoningEffort: "low",
      maxTokens: 3200,
      signal: input.signal,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `MÅLGRUPPE: ${input.spec.audience}
SPRÅK: ${input.spec.language}
VALGTE OMRÅDER: ${topicLabels.join(", ")}
ANVENDTE FILTRE: ${JSON.stringify(appliedFilters)}
BRIEF: ${input.spec.brief || "Ingen ekstra føringer."}

FACTS:
${JSON.stringify(compactFacts)}`
        }
      ]
    })) {
      yield event;
    }
  } finally {
    await input.release();
  }
}
