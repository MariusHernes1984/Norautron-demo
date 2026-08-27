"use client";

import { FolderOpen, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReportDocument, ReportSummary } from "@/lib/types";

type LibraryState =
  | { status: "loading"; reports: ReportSummary[] }
  | { status: "error"; reports: ReportSummary[]; message: string }
  | { status: "ready"; reports: ReportSummary[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReportSummary(value: unknown): value is ReportSummary {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.id) &&
    Number(value.id) > 0 &&
    typeof value.title === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.datasetVersion === "string" &&
    typeof value.modelDeployment === "string" &&
    Number.isInteger(value.topicCount)
  );
}

function isReportDocument(value: unknown): value is ReportDocument {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.datasetVersion === "string" &&
    typeof value.modelDeployment === "string" &&
    Array.isArray(value.executiveSummary) &&
    Array.isArray(value.kpis) &&
    Array.isArray(value.sections) &&
    Array.isArray(value.risks) &&
    Array.isArray(value.actions) &&
    isRecord(value.qa)
  );
}

async function responseError(response: Response, fallback: string) {
  try {
    const body: unknown = await response.json();
    return isRecord(body) && typeof body.error === "string"
      ? body.error
      : fallback;
  } catch {
    return fallback;
  }
}

function reportDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Ukjent dato"
    : new Intl.DateTimeFormat("nb-NO", {
        day: "2-digit",
        month: "short",
        year: "numeric"
      }).format(date);
}

export function ReportLibrary({
  onOpen,
  refreshToken = 0
}: {
  onOpen: (report: ReportDocument) => void;
  refreshToken?: number;
}) {
  const [state, setState] = useState<LibraryState>({
    status: "loading",
    reports: []
  });
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setState((current) => ({ status: "loading", reports: current.reports }));
    try {
      const response = await fetch("/api/reports", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(
          await responseError(response, "Rapportbiblioteket kunne ikke lastes.")
        );
      }
      const body: unknown = await response.json();
      if (!Array.isArray(body) || !body.every(isReportSummary)) {
        throw new Error("Rapportbiblioteket returnerte ugyldige data.");
      }
      if (sequence === requestSequence.current) {
        setState({ status: "ready", reports: body });
      }
    } catch (error) {
      if (sequence === requestSequence.current) {
        setState((current) => ({
          status: "error",
          reports: current.reports,
          message:
            error instanceof Error
              ? error.message
              : "Rapportbiblioteket kunne ikke lastes."
        }));
      }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      requestSequence.current += 1;
    };
  }, [load, refreshToken]);

  async function openReport(id: number) {
    if (openingId !== null) return;
    setActionError(null);
    setOpeningId(id);
    try {
      const response = await fetch(`/api/reports?id=${id}`, {
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error(
          await responseError(response, "Rapporten kunne ikke åpnes.")
        );
      }
      const body: unknown = await response.json();
      if (!isReportDocument(body)) {
        throw new Error("Rapporten returnerte ugyldige data.");
      }
      onOpen(body);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Rapporten kunne ikke åpnes."
      );
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <section className="card p-5" aria-labelledby="report-library-title">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="report-library-title" className="font-semibold">
            Rapportbibliotek
          </h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            De 50 nyeste rapportene
          </p>
        </div>
        <button
          type="button"
          className="secondary-button h-9 w-9 p-0"
          aria-label="Oppdater rapportbibliotek"
          disabled={state.status === "loading"}
          onClick={() => void load()}
        >
          <RefreshCw
            size={15}
            className={state.status === "loading" ? "animate-spin" : ""}
          />
        </button>
      </div>

      {actionError && (
        <p className="mt-3 rounded-lg bg-[#fee2e2] p-3 text-xs text-[#991b1b]" role="alert">
          {actionError}
        </p>
      )}

      {state.status === "loading" && state.reports.length === 0 && (
        <div
          className="mt-4 flex items-center gap-2 text-sm text-[var(--muted)]"
          role="status"
        >
          <LoaderCircle size={16} className="animate-spin" />
          Laster rapporter
        </div>
      )}

      {state.status === "error" && (
        <div className="mt-4 rounded-xl bg-[#fee2e2] p-3 text-sm text-[#991b1b]" role="alert">
          <p>{state.message}</p>
          <button
            type="button"
            className="mt-2 font-semibold underline"
            onClick={() => void load()}
          >
            Prøv igjen
          </button>
        </div>
      )}

      {state.status === "ready" && state.reports.length === 0 && (
        <div className="mt-4 rounded-xl bg-[var(--quiet)] p-4 text-sm text-[var(--muted)]">
          Ingen lagrede rapporter ennå.
        </div>
      )}

      {state.reports.length > 0 && (
        <ul className="mt-4 max-h-[430px] space-y-2 overflow-y-auto">
          {state.reports.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="w-full rounded-xl border border-[var(--border)] bg-white p-3 text-left hover:border-[var(--brand)]"
                disabled={openingId !== null}
                aria-busy={openingId === item.id}
                aria-label={`Åpne rapport ${item.title}`}
                onClick={() => void openReport(item.id)}
              >
                {openingId === item.id && (
                  <span className="sr-only" role="status">
                    Åpner rapporten
                  </span>
                )}
                <span className="flex items-start gap-2">
                  {openingId === item.id ? (
                    <LoaderCircle
                      size={16}
                      className="mt-0.5 shrink-0 animate-spin text-[var(--brand)]"
                    />
                  ) : (
                    <FolderOpen
                      size={16}
                      className="mt-0.5 shrink-0 text-[var(--brand)]"
                    />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {item.title}
                    </span>
                    <span className="mt-1 block text-[11px] text-[var(--muted)]">
                      {reportDate(item.createdAt)} · {item.topicCount} områder
                    </span>
                    <span className="mt-1 block truncate text-[10px] text-[var(--muted)]">
                      Dataset {item.datasetVersion} · {item.modelDeployment}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
