import type {
  ReportDocument,
  ReportSpec,
  ReportSummary
} from "../types";
import { parseReportSpec } from "../reports/spec";
import {
  deserializeReport,
  REPORT_SPEC_MAX_CHARACTERS,
  REPORT_STORAGE_VERSION,
  serializeReport
} from "../reports/storage";
import { executeSql, queryRows } from "./query";

export async function saveReport(
  report: ReportDocument,
  spec: ReportSpec
): Promise<{ id: number }> {
  const boundedSpec = parseReportSpec(spec);
  if (!boundedSpec.ok) {
    throw new Error("Rapportspesifikasjonen er ugyldig.");
  }
  const specJson = JSON.stringify(boundedSpec.value);
  if (specJson.length > REPORT_SPEC_MAX_CHARACTERS) {
    throw new Error("Rapportspesifikasjonen er for stor til å lagres.");
  }
  const reportJson = serializeReport(report);
  const result = await executeSql(
    `
      INSERT INTO app.report
        (
          title,
          report_json,
          report_schema_version,
          spec_json,
          dataset_version,
          model_deployment
        )
      OUTPUT INSERTED.id
      VALUES
        (@title, @report, @schemaVersion, @spec, @version, @deployment)
    `,
    [
      { name: "title", type: "nvarchar", length: 200, value: report.title },
      {
        name: "report",
        type: "nvarchar",
        length: sqlMax(),
        value: reportJson
      },
      {
        name: "schemaVersion",
        type: "int",
        value: REPORT_STORAGE_VERSION
      },
      {
        name: "spec",
        type: "nvarchar",
        length: sqlMax(),
        value: specJson
      },
      {
        name: "version",
        type: "nvarchar",
        length: 100,
        value: report.datasetVersion
      },
      {
        name: "deployment",
        type: "nvarchar",
        length: 100,
        value: report.modelDeployment
      }
    ],
    "report_save"
  );
  const id = Number(result.recordset[0]?.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Databasen returnerte ikke en gyldig rapport-ID.");
  }
  return { id };
}

function sqlMax() {
  return -1;
}

export async function listReports(): Promise<ReportSummary[]> {
  const rows = await queryRows<{
    id: number;
    title: string;
    created_at: Date;
    dataset_version: string;
    model_deployment: string;
    spec_json: string;
  }>(`
    SELECT TOP (50)
      id, title, created_at, dataset_version, model_deployment, spec_json
    FROM app.report
    ORDER BY created_at DESC, id DESC
  `, [], "report_list");
  return rows.map((row) => {
    let topicCount = 0;
    try {
      const spec = JSON.parse(row.spec_json) as { topics?: unknown[] };
      topicCount = Array.isArray(spec.topics) ? spec.topics.length : 0;
    } catch {
      topicCount = 0;
    }
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at.toISOString(),
      datasetVersion: row.dataset_version,
      modelDeployment: row.model_deployment,
      topicCount
    };
  });
}

export async function getReport(id: number): Promise<ReportDocument | null> {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Ugyldig rapport-ID.");
  }
  const rows = await queryRows<{
    id: number;
    title: string;
    report_json: string;
    report_schema_version: number;
    dataset_version: string;
    model_deployment: string;
    created_at: Date;
  }>(
    `SELECT
       id,
       title,
       report_json,
       report_schema_version,
       dataset_version,
       model_deployment,
       created_at
     FROM app.report
     WHERE id = @id`,
    [{ name: "id", type: "int", value: id }],
    "report_get"
  );
  if (!rows[0]) return null;
  const row = rows[0];
  const report = deserializeReport(
    row.report_json,
    row.report_schema_version
  );
  return {
    ...report,
    id: row.id,
    title: row.title,
    datasetVersion: row.dataset_version,
    modelDeployment: row.model_deployment,
    createdAt: row.created_at.toISOString()
  };
}
