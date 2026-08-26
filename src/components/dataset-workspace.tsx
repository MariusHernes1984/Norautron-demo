"use client";

import {
  CheckCircle2,
  Database,
  FileSpreadsheet,
  LoaderCircle,
  RefreshCcw,
  TriangleAlert
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { DatasetStatus } from "@/lib/types";
import { formatDate } from "@/lib/utils";

function isDatasetStatus(value: unknown): value is DatasetStatus {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DatasetStatus>;
  return (
    typeof candidate.ready === "boolean" &&
    typeof candidate.totalRows === "number" &&
    Array.isArray(candidate.sources)
  );
}

async function fetchDatasetStatus(signal?: AbortSignal) {
  const response = await fetch("/api/dataset", {
    cache: "no-store",
    signal
  });
  const body: unknown = await response.json();
  if (!response.ok || !isDatasetStatus(body)) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : null;
    throw new Error(message || "Datasetstatus feilet.");
  }
  return body;
}

export function DatasetWorkspace() {
  const [status, setStatus] = useState<DatasetStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await fetchDatasetStatus());
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Datasetstatus feilet."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchDatasetStatus(controller.signal)
      .then(setStatus)
      .catch((fetchError: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Datasetstatus feilet."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto bg-[var(--quiet)] p-5 sm:p-8"
      aria-busy={loading}
    >
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Datasett</h1>
            <p className="mt-1 text-[var(--muted)]">
              Excel-kilden, aktiv SQL-versjon og radkontroller.
            </p>
          </div>
          <button
            className="secondary-button px-4"
            type="button"
            disabled={loading}
            title={loading ? "Datasetstatus oppdateres" : "Oppdater datasetstatus"}
            onClick={() => void refresh()}
          >
            <RefreshCcw size={16} className={loading ? "animate-spin" : ""} />
            Oppdater
          </button>
        </div>

        {error ? (
          <div className="mt-6 card flex items-start gap-3 border-[#fecaca] p-5 text-[#991b1b]">
            <TriangleAlert size={20} className="mt-0.5 shrink-0" />
            <div>
              <h2 className="font-semibold">Datasettet er ikke tilgjengelig</h2>
              <p className="mt-1 text-sm">{error}</p>
            </div>
          </div>
        ) : status ? (
          <>
            <section className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="card p-5">
                <FileSpreadsheet
                  size={20}
                  className="text-[var(--brand)]"
                />
                <p className="mt-3 text-xs text-[var(--muted)]">Kildefil</p>
                <p className="mt-1 font-semibold">
                  {status.blobName ?? "Ikke lastet"}
                </p>
              </div>
              <div className="card p-5">
                <Database size={20} className="text-[var(--brand)]" />
                <p className="mt-3 text-xs text-[var(--muted)]">
                  Aktiv versjon
                </p>
                <p className="mt-1 font-semibold">
                  {status.version ?? "Ingen"}
                </p>
              </div>
              <div className="card p-5">
                <CheckCircle2 size={20} className="text-[var(--brand)]" />
                <p className="mt-3 text-xs text-[var(--muted)]">Rader</p>
                <p className="mt-1 text-2xl font-semibold">
                  {status.totalRows.toLocaleString("nb-NO")}
                </p>
              </div>
            </section>

            <section className="mt-5 card overflow-hidden">
              <div className="border-b border-[var(--border)] px-5 py-4">
                <h2 className="font-semibold">Datakilder</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Sist lastet{" "}
                  {status.loadedAt ? formatDate(status.loadedAt) : "aldri"}
                </p>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {status.sources.length === 0 ? (
                  <div className="px-5 py-8 text-center text-sm text-[var(--muted)]">
                    Ingen datakilder er registrert.
                  </div>
                ) : (
                  status.sources.map((source) => (
                    <div
                      key={source.name}
                      className="flex items-center justify-between gap-3 px-5 py-4"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            source.status === "ready"
                              ? "bg-[var(--brand)]"
                              : "bg-[#d1d5db]"
                          }`}
                        />
                        <span className="font-medium">{source.name}</span>
                      </div>
                      <div className="text-right text-sm">
                        <span className="block text-[var(--muted)]">
                          {source.rows.toLocaleString("nb-NO")} rader
                        </span>
                        <span className="mt-0.5 block text-xs">
                          {source.status === "ready" ? "Klar" : "Mangler"}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        ) : (
          <div
            className="mt-6 card flex items-center justify-center gap-3 p-8 text-center text-[var(--muted)]"
            role="status"
            aria-live="polite"
          >
            <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
            Henter datasetstatus …
          </div>
        )}
      </div>
    </div>
  );
}
