"use client";

import type { ReportDocument } from "@/lib/types";
import { ChartRenderer } from "./chart-renderer";

export function ReportView({ report }: { report: ReportDocument }) {
  const factLabels = new Map(
    report.kpis.map((kpi) => [kpi.id, kpi.label])
  );
  const factLabel = (factId: string) =>
    factLabels.get(factId) ??
    (factId.includes(":row:") ? "Verifisert detaljrad" : factId);

  return (
    <article className="report-document bg-white p-6 sm:p-9">
      <header className="rounded-2xl bg-[var(--brand)] p-6 text-white">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/75">
          Norautron Analytics
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          {report.title}
        </h1>
        <p className="mt-2 text-white/80">{report.subtitle}</p>
      </header>

      <section className="mt-6 card p-5" data-pdf-avoid>
        <h2 className="text-lg font-semibold">Ledelsesoppsummering</h2>
        <div className="mt-3 space-y-3">
          {report.executiveSummary.map((claim, index) => (
            <div key={`${claim.text}-${index}`}>
              <p className="leading-7">{claim.text}</p>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                Fakta: {claim.factIds.map(factLabel).join(", ")}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {report.kpis.map((item) => (
          <div key={item.id} className="card p-4" data-pdf-avoid>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              {item.label}
            </p>
            <p className="mt-2 text-2xl font-semibold text-[var(--brand)]">
              {item.formatted}
            </p>
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              {item.sourceView}
            </p>
          </div>
        ))}
      </section>

      <div className="mt-7 space-y-6">
        {report.sections.map((section) => (
          <section key={section.topic} className="space-y-4">
            <div className="card p-5" data-pdf-avoid>
              <h2 className="text-lg font-semibold">{section.title}</h2>
              <div className="mt-3 space-y-3">
                {section.claims.map((claim, index) => (
                  <div key={`${claim.text}-${index}`}>
                    <p className="leading-7">{claim.text}</p>
                    <p className="mt-1 text-[11px] text-[var(--muted)]">
                      Fakta: {claim.factIds.map(factLabel).join(", ")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            {section.chart && <ChartRenderer spec={section.chart} />}
          </section>
        ))}
      </div>

      {(report.risks.length > 0 || report.actions.length > 0) && (
        <section className="mt-7 grid gap-4 lg:grid-cols-2">
          {report.risks.length > 0 && (
            <div className="card p-5" data-pdf-avoid>
              <h2 className="font-semibold">Risikoer</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                {report.risks.map((risk, index) => (
                  <li key={`${risk.text}-${index}`}>
                    {risk.text}
                    <span className="mt-1 block text-[11px] text-[var(--muted)]">
                      Fakta: {risk.factIds.map(factLabel).join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.actions.length > 0 && (
            <div className="card p-5" data-pdf-avoid>
              <h2 className="font-semibold">Anbefalte tiltak</h2>
              <ol className="mt-3 list-decimal space-y-2 pl-5">
                {report.actions.map((action, index) => (
                  <li key={`${action.text}-${index}`}>
                    {action.text}
                    <span className="mt-1 block text-[11px] text-[var(--muted)]">
                      Fakta: {action.factIds.map(factLabel).join(", ")}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}

      {report.methodology && (
        <section className="mt-7 rounded-2xl bg-[var(--quiet)] p-5 text-sm">
          <h2 className="font-semibold">Metode</h2>
          <p className="mt-2 leading-6 text-[var(--muted)]">
            {report.methodology}
          </p>
        </section>
      )}
      <footer className="mt-7 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
        Dataset {report.datasetVersion} · {report.modelDeployment} ·{" "}
        {report.qa.verified}/{report.qa.total} KPI-er verifisert ·{" "}
        {report.qa.groundedClaims}/{report.qa.totalClaims} påstander
        faktagrunnlagt
      </footer>
    </article>
  );
}
