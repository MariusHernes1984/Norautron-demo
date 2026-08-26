import type { ReportDocument } from "../types";

export const REPORT_STORAGE_VERSION = 1 as const;
export const REPORT_JSON_MAX_CHARACTERS = 2_000_000;
export const REPORT_SPEC_MAX_CHARACTERS = 8_192;

type StoredReportEnvelope = {
  schemaVersion: typeof REPORT_STORAGE_VERSION;
  datasetVersion: string;
  modelDeployment: string;
  report: ReportDocument;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReportDocument(value: unknown): value is ReportDocument {
  if (!isRecord(value)) return false;
  return (
    typeof value.title === "string" &&
    typeof value.datasetVersion === "string" &&
    typeof value.modelDeployment === "string" &&
    typeof value.createdAt === "string" &&
    Array.isArray(value.executiveSummary) &&
    Array.isArray(value.kpis) &&
    Array.isArray(value.sections) &&
    Array.isArray(value.risks) &&
    Array.isArray(value.actions) &&
    isRecord(value.qa)
  );
}

export function serializeReport(report: ReportDocument) {
  const envelope: StoredReportEnvelope = {
    schemaVersion: REPORT_STORAGE_VERSION,
    datasetVersion: report.datasetVersion,
    modelDeployment: report.modelDeployment,
    report
  };
  const json = JSON.stringify(envelope);
  if (json.length > REPORT_JSON_MAX_CHARACTERS) {
    throw new Error("Rapporten er for stor til å lagres.");
  }
  return json;
}

export function deserializeReport(
  json: string,
  schemaVersion: number = REPORT_STORAGE_VERSION
): ReportDocument {
  if (
    !Number.isInteger(schemaVersion) ||
    schemaVersion !== REPORT_STORAGE_VERSION
  ) {
    throw new Error(`Rapportformat ${schemaVersion} støttes ikke.`);
  }
  if (!json || json.length > REPORT_JSON_MAX_CHARACTERS) {
    throw new Error("Lagret rapport har ugyldig størrelse.");
  }

  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed) || parsed.schemaVersion !== REPORT_STORAGE_VERSION) {
    throw new Error("Lagret rapport mangler en støttet formatversjon.");
  }
  if (
    typeof parsed.datasetVersion !== "string" ||
    typeof parsed.modelDeployment !== "string" ||
    !isReportDocument(parsed.report)
  ) {
    throw new Error("Lagret rapport har ugyldig format.");
  }
  if (
    parsed.datasetVersion !== parsed.report.datasetVersion ||
    parsed.modelDeployment !== parsed.report.modelDeployment
  ) {
    throw new Error("Lagret rapport har inkonsistente metadata.");
  }
  return parsed.report;
}
