export type Row = Record<string, unknown>;

export type ChartSpec = {
  type: "bar" | "hbar" | "line" | "area" | "pie";
  title: string;
  xKey: string;
  yKeys: string[];
  data: Record<string, string | number>[];
  /** Values are ratios in the 0–1 range and are formatted as percentages. */
  percent?: boolean;
  sampleTotal?: number;
};

export type PipelineStage = "schema" | "sql" | "query" | "compose";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  chart?: ChartSpec | null;
  evidence?: ChatEvidence;
  followUps?: string[];
};

export type ChatEvidence = {
  sql: string;
  tables: string[];
  rowCount: number;
  datasetVersion: string;
  generatedAt: string;
};

export type ChatAnswer = {
  answer: string;
  chart: ChartSpec | null;
  evidence: ChatEvidence;
  followUps: string[];
};

export type KpiTopicId =
  | "executive"
  | "sales"
  | "pipeline"
  | "production"
  | "quality"
  | "supply";

export type ReportLanguage = "no" | "en";
export type ReportAudience = "ledelse" | "salg" | "drift";

export type ReportFilters = {
  regions: string[];
  productFamilies: string[];
  factories: string[];
};

export type ReportSpec = {
  title?: string;
  topics: KpiTopicId[];
  language: ReportLanguage;
  audience: ReportAudience;
  periodFrom?: string;
  periodTo?: string;
  filters: ReportFilters;
  includeRisks: boolean;
  includeActions: boolean;
  includeMethodology: boolean;
  brief: string;
};

export type ReportKpi = {
  id: string;
  label: string;
  value: number;
  formatted: string;
  change?: number;
  sourceView: string;
};

export type ReportSection = {
  topic: KpiTopicId;
  title: string;
  claims: ReportClaim[];
  chart?: ChartSpec | null;
};

export type ReportClaim = {
  text: string;
  factIds: string[];
};

export type ReportQaCheck = {
  factId: string;
  sourceView: string;
  expected: number;
  actual: number;
  ok: boolean;
};

export type ReportDocument = {
  id?: number;
  title: string;
  subtitle: string;
  executiveSummary: ReportClaim[];
  kpis: ReportKpi[];
  sections: ReportSection[];
  risks: ReportClaim[];
  actions: ReportClaim[];
  methodology?: string;
  datasetVersion: string;
  modelDeployment: string;
  createdAt: string;
  qa: {
    verified: number;
    total: number;
    ok: boolean;
    groundedClaims: number;
    totalClaims: number;
    checks: ReportQaCheck[];
  };
};

export type ReportSummary = {
  id: number;
  title: string;
  createdAt: string;
  datasetVersion: string;
  modelDeployment: string;
  topicCount: number;
};

export type DatasetStatus = {
  ready: boolean;
  state: "missing" | "loading" | "staged" | "active" | "archived" | "failed";
  version: string | null;
  blobName: string | null;
  blobEtag: string | null;
  loadedAt: string | null;
  totalRows: number;
  latestAttempt: {
    version: string;
    status: DatasetStatus["state"];
    createdAt: string | null;
    validatedAt: string | null;
  } | null;
  sources: Array<{
    name: string;
    rows: number;
    status: "ready" | "missing";
  }>;
};
