import type { DatasetStatus } from "../types";
import { recordDatasetStatus } from "../telemetry";
import schema from "../../../data/schema.json";
import { queryRows } from "./query";

type VersionRow = {
  version_id: string | null;
  blob_name: string | null;
  blob_etag: string | null;
  loaded_at: Date | null;
  total_rows: number | null;
  source_row_counts: string | null;
  latest_version_id: string | null;
  latest_status: DatasetStatus["state"] | null;
  latest_created_at: Date | null;
  latest_validated_at: Date | null;
};

export async function getDatasetStatus(): Promise<DatasetStatus> {
  const rows = await queryRows<VersionRow>(`
    SELECT
      active.version_id,
      active.blob_name,
      active.blob_etag,
      active.loaded_at,
      active.total_rows,
      active.source_row_counts,
      latest.version_id AS latest_version_id,
      latest.status AS latest_status,
      latest.created_at AS latest_created_at,
      latest.validated_at AS latest_validated_at
    FROM (VALUES (1)) AS seed(value)
    OUTER APPLY (
      SELECT TOP (1)
        version_id, blob_name, blob_etag, loaded_at, total_rows, source_row_counts
      FROM app.dataset_version
      WHERE status = N'active'
      ORDER BY loaded_at DESC
    ) AS active
    OUTER APPLY (
      SELECT TOP (1) version_id, status, created_at, validated_at
      FROM app.dataset_version
      ORDER BY created_at DESC
    ) AS latest
  `, [], "dataset_status");
  const active = rows[0];
  let sourceCounts: Record<string, number> = {};
  try {
    sourceCounts = active?.source_row_counts
      ? (JSON.parse(active.source_row_counts) as Record<string, number>)
      : {};
  } catch {
    sourceCounts = {};
  }
  const ready = Boolean(active?.version_id);
  const status: DatasetStatus = {
    ready,
    state: ready ? "active" : (active?.latest_status ?? "missing"),
    version: active?.version_id ?? null,
    blobName: active?.blob_name ?? null,
    blobEtag: active?.blob_etag ?? null,
    loadedAt: active?.loaded_at?.toISOString() ?? null,
    totalRows: active?.total_rows ?? 0,
    latestAttempt: active?.latest_version_id
      ? {
          version: active.latest_version_id,
          status: active.latest_status ?? "missing",
          createdAt: active.latest_created_at?.toISOString() ?? null,
          validatedAt: active.latest_validated_at?.toISOString() ?? null
        }
      : null,
    sources: schema.sources.map((source) => ({
      name: source.sheet,
      rows: ready
        ? (sourceCounts[source.sheet] ?? source.expectedRows)
        : 0,
      status: ready ? "ready" : "missing"
    }))
  };
  recordDatasetStatus(status.ready, status.state, status.totalRows);
  return status;
}

export async function getActiveDatasetVersion() {
  const rows = await queryRows<{ version_id: string }>(`
    SELECT TOP (1) version_id
    FROM app.dataset_version
    WHERE status = N'active'
    ORDER BY loaded_at DESC
  `, [], "active_dataset_version");
  if (!rows[0]) {
    throw new Error("Ingen aktiv datasetversjon er lastet.");
  }
  return rows[0].version_id;
}
