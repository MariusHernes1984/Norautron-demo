"use client";

import {
  Check,
  Download,
  FileBarChart,
  LoaderCircle,
  X
} from "lucide-react";
import { useRef, useState } from "react";
import {
  DEFAULT_REPORT_SPEC,
  KPI_TOPICS,
  PIPELINE_STAGES
} from "@/lib/constants";
import { REPORT_LIMITS } from "@/lib/reports/spec";
import { streamSSE } from "@/lib/sse-client";
import { downloadElementAsPdf } from "@/lib/download";
import type {
  KpiTopicId,
  PipelineStage,
  ReportDocument,
  ReportSpec
} from "@/lib/types";
import { ReportView } from "./report-view";
import { ReportLibrary } from "./report-library";

export function ReportsWorkspace() {
  const [spec, setSpec] = useState<ReportSpec>(DEFAULT_REPORT_SPEC);
  const [report, setReport] = useState<ReportDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<PipelineStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [exporting, setExporting] = useState(false);
  const reportElement = useRef<HTMLDivElement>(null);
  const [filterDrafts, setFilterDrafts] = useState({
    regions: "",
    productFamilies: "",
    factories: ""
  });

  function toggleTopic(topic: KpiTopicId) {
    setSpec((current) => {
      const selected = current.topics.includes(topic);
      if (!selected && current.topics.length >= REPORT_LIMITS.topics) {
        return current;
      }
      const topics = selected
        ? current.topics.filter((item) => item !== topic)
        : [...current.topics, topic];
      return { ...current, topics };
    });
  }

  function updateFilter(
    key: keyof ReportSpec["filters"],
    rawValue: string
  ) {
    setFilterDrafts((current) => ({ ...current, [key]: rawValue }));
    const values = rawValue
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, REPORT_LIMITS.filterValues);
    setSpec((current) => ({
      ...current,
      filters: { ...current.filters, [key]: values }
    }));
  }

  function toggleBlock(
    key: "includeRisks" | "includeActions" | "includeMethodology"
  ) {
    setSpec((current) => ({ ...current, [key]: !current[key] }));
  }

  async function generate() {
    if (!spec.topics.length || loading) return;
    setError(null);
    setLoading(true);
    setStage("schema");
    await streamSSE<ReportDocument>("/api/reports/generate", spec, {
      onStage: setStage,
      onDone: (event) => {
        if (event.ok) {
          const saved =
            typeof event.saved === "object" &&
            event.saved !== null &&
            "id" in event.saved &&
            Number.isSafeInteger(event.saved.id) &&
            Number(event.saved.id) > 0
              ? Number(event.saved.id)
              : null;
          setReport(saved ? { ...event.result, id: saved } : event.result);
          if (saved) {
            setLibraryRevision((current) => current + 1);
          } else {
            setError(
              "Rapporten ble generert, men kunne ikke lagres i biblioteket."
            );
          }
        } else {
          setError(event.error);
        }
        setLoading(false);
        setStage(null);
      },
      onError: (streamError) => {
        setError(
          streamError instanceof Error
            ? streamError.message
            : "Rapportgenereringen feilet."
        );
        setLoading(false);
        setStage(null);
      }
    });
  }

  async function exportPdf() {
    if (!report || !reportElement.current || exporting) return;
    setError(null);
    setExporting(true);
    try {
      await downloadElementAsPdf(
        reportElement.current,
        `norautron-${report.title}`,
        { title: report.title, date: report.createdAt }
      );
    } catch {
      setError("PDF-eksporten feilet. Prøv igjen.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--quiet)] p-4 sm:p-6">
      <div className="mx-auto grid max-w-[1600px] gap-5 xl:grid-cols-[370px_minmax(0,1fr)]">
        <aside className="space-y-5">
          <section className="card p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                <FileBarChart size={20} />
              </div>
              <div>
                <h1 className="text-lg font-semibold">Ny KPI-rapport</h1>
                <p className="text-xs text-[var(--muted)]">
                  {spec.topics.length}/{REPORT_LIMITS.topics} analyseområder
                </p>
              </div>
            </div>

            <label className="mt-5 block text-xs font-semibold" htmlFor="title">
              Rapporttittel
            </label>
            <input
              id="title"
              className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2.5"
              placeholder="Valgfri tittel"
              maxLength={REPORT_LIMITS.titleCharacters}
              value={spec.title ?? ""}
              disabled={loading}
              onChange={(event) =>
                setSpec((current) => ({
                  ...current,
                  title: event.target.value
                }))
              }
            />

            <fieldset className="mt-5">
              <legend className="text-xs font-semibold">KPI-områder</legend>
              <div className="mt-2 grid gap-2">
                {KPI_TOPICS.map((topic) => {
                  const selected = spec.topics.includes(topic.id);
                  return (
                    <button
                      key={topic.id}
                      type="button"
                      className={`rounded-xl border p-3 text-left ${
                        selected
                          ? "border-[var(--brand)] bg-[var(--brand-soft)]"
                          : "border-[var(--border)] bg-white"
                      }`}
                      aria-pressed={selected}
                      disabled={
                       loading ||
                       (!selected &&
                         spec.topics.length >= REPORT_LIMITS.topics)
                      }
                      onClick={() => toggleTopic(topic.id)}
                    >
                      <span className="flex items-center justify-between gap-2 font-semibold">
                        {topic.label}
                        {selected && (
                          <Check size={16} className="text-[var(--brand)]" />
                        )}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
                        {topic.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="mt-5">
             <legend className="text-xs font-semibold">Rapportperiode</legend>
             <div className="mt-2 grid grid-cols-2 gap-3">
               <label className="text-xs text-[var(--muted)]">
                 Fra
                 <input
                   type="date"
                   className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2.5 text-[var(--ink)]"
                   value={spec.periodFrom ?? ""}
                   max={spec.periodTo}
                   disabled={loading}
                   onChange={(event) =>
                     setSpec((current) => ({
                       ...current,
                       periodFrom: event.target.value || undefined
                     }))
                   }
                 />
               </label>
               <label className="text-xs text-[var(--muted)]">
                 Til
                 <input
                   type="date"
                   className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2.5 text-[var(--ink)]"
                   value={spec.periodTo ?? ""}
                   min={spec.periodFrom}
                   disabled={loading}
                   onChange={(event) =>
                     setSpec((current) => ({
                       ...current,
                       periodTo: event.target.value || undefined
                     }))
                   }
                 />
               </label>
             </div>
            </fieldset>

            <details className="mt-5 rounded-xl border border-[var(--border)] p-3">
             <summary className="cursor-pointer text-xs font-semibold">
               Avgrensninger
             </summary>
             <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
               Kommaseparert, maksimalt {REPORT_LIMITS.filterValues} verdier
               per felt. Filteret brukes der KPI-området har dimensjonen.
             </p>
             {(
               [
                 ["regions", "Regioner"],
                 ["productFamilies", "Produktfamilier"],
                 ["factories", "Fabrikker"]
               ] as const
             ).map(([key, label]) => (
               <label key={key} className="mt-3 block text-xs font-semibold">
                 {label}
                 <input
                   className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2 font-normal"
                   maxLength={
                     REPORT_LIMITS.filterValues *
                     (REPORT_LIMITS.filterValueCharacters + 1)
                   }
                   value={filterDrafts[key]}
                   disabled={loading}
                   onChange={(event) => updateFilter(key, event.target.value)}
                 />
               </label>
             ))}
            </details>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold">
                Målgruppe
                <select
                  className="mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 font-normal"
                  value={spec.audience}
                  disabled={loading}
                  onChange={(event) =>
                    setSpec((current) => ({
                      ...current,
                      audience: event.target.value as ReportSpec["audience"]
                    }))
                  }
                >
                  <option value="ledelse">Ledelse</option>
                  <option value="salg">Salg</option>
                  <option value="drift">Drift</option>
                </select>
              </label>
              <label className="text-xs font-semibold">
                Språk
                <select
                  className="mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 font-normal"
                  value={spec.language}
                  disabled={loading}
                  onChange={(event) =>
                    setSpec((current) => ({
                      ...current,
                      language: event.target.value as ReportSpec["language"]
                    }))
                  }
                >
                  <option value="no">Norsk</option>
                  <option value="en">English</option>
                </select>
              </label>
            </div>

            <label className="mt-5 block text-xs font-semibold" htmlFor="brief">
              Ekstra føringer
            </label>
            <textarea
              id="brief"
              className="mt-2 min-h-24 w-full resize-y rounded-xl border border-[var(--border)] px-3 py-2.5"
              maxLength={REPORT_LIMITS.briefCharacters}
              placeholder="Eksempel: Legg særlig vekt på margin og leverandørrisiko."
              value={spec.brief}
              disabled={loading}
              onChange={(event) =>
                setSpec((current) => ({
                  ...current,
                  brief: event.target.value
                }))
              }
            />

            <div className="mt-4 flex flex-wrap gap-2">
              {(
                [
                  ["includeRisks", "Risikoer"],
                  ["includeActions", "Tiltak"],
                  ["includeMethodology", "Metode"]
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className="pill"
                  data-selected={spec[key]}
                  disabled={loading}
                  onClick={() => toggleBlock(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="primary-button mt-5 w-full px-4"
              disabled={!spec.topics.length || loading}
              title={
                spec.topics.length
                  ? "Generer rapport"
                  : "Velg minst ett KPI-område"
              }
              onClick={() => void generate()}
            >
              {loading ? (
                <>
                  <LoaderCircle size={17} className="animate-spin" />
                  Genererer
                </>
              ) : (
                <>
                  <FileBarChart size={17} />
                  Generer rapport
                </>
              )}
            </button>
            {loading && stage && (
              <div
                className="mt-4 space-y-2"
                role="status"
                aria-live="polite"
              >
                {PIPELINE_STAGES.map((item) => (
                  <p
                    key={item.id}
                    className={`flex items-center gap-2 text-xs ${
                      item.id === stage
                        ? "font-semibold text-[var(--brand)]"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full bg-current" />
                    {item.label}
                  </p>
                ))}
              </div>
            )}
          </section>

          <ReportLibrary
            refreshToken={libraryRevision}
            onOpen={(savedReport) => {
              setError(null);
              setReport(savedReport);
            }}
          />
        </aside>

        <section className="min-w-0">
          {error && (
            <div
              className="mb-4 flex items-center justify-between rounded-xl bg-[#fee2e2] px-4 py-3 text-[#991b1b]"
              role="alert"
            >
              {error}
              <button
                type="button"
                className="rounded-lg p-1"
                aria-label="Lukk feilmelding"
                onClick={() => setError(null)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {report ? (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-white px-4 py-3">
                <p className="truncate text-xs text-[var(--muted)]">
                  {report.id ? `Lagret rapport #${report.id}` : "Rapport"}
                </p>
                <button
                  type="button"
                  className="secondary-button px-3"
                  disabled={exporting}
                  onClick={() => void exportPdf()}
                >
                  {exporting ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <Download size={16} />
                  )}
                  {exporting ? "Lager PDF" : "Last ned PDF"}
                </button>
              </div>
              <div ref={reportElement}>
                <ReportView report={report} />
              </div>
            </div>
          ) : (
            <div className="card flex min-h-[560px] items-center justify-center p-8 text-center">
              <div>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#edeeee] text-[var(--muted)]">
                  <FileBarChart size={23} />
                </div>
                <h2 className="mt-4 text-lg font-semibold">
                  Bygg en verifiserbar KPI-rapport
                </h2>
                <p className="mx-auto mt-2 max-w-md text-[var(--muted)]">
                  Velg KPI-områder til venstre. Tallene beregnes i SQL og
                  narrativet skrives av GPT-5.6-Terra.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
