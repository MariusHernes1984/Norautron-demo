import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportDocument, ReportSummary } from "@/lib/types";
import { ReportLibrary } from "./report-library";

const summary: ReportSummary = {
  id: 7,
  title: "Styrepakke Q3",
  createdAt: "2026-08-26T10:00:00.000Z",
  datasetVersion: "dataset-v1",
  modelDeployment: "gpt-test",
  topicCount: 2
};

const report = {
  id: 7,
  title: "Styrepakke Q3",
  subtitle: "Verifisert rapport",
  executiveSummary: [],
  kpis: [],
  createdAt: "2026-08-26T10:00:00.000Z",
  sections: [],
  risks: [],
  actions: [],
  datasetVersion: "dataset-v1",
  modelDeployment: "gpt-test",
  qa: {
    verified: 0,
    total: 0,
    ok: true,
    groundedClaims: 0,
    totalClaims: 0,
    checks: []
  }
} satisfies ReportDocument;

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body)
  } as unknown as Response;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("report library", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("shows loading and then the empty state", async () => {
    let resolveFetch!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })
    );

    await act(async () => {
      root.render(<ReportLibrary onOpen={vi.fn()} />);
    });
    expect(container.textContent).toContain("Laster rapporter");

    resolveFetch(jsonResponse([]));
    await settle();
    expect(container.textContent).toContain("Ingen lagrede rapporter ennå.");
  });

  it("recovers from an error, lists reports and reopens one", async () => {
    let resolveReport!: (response: Response) => void;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ error: "Database nede" }, 503))
      .mockResolvedValueOnce(jsonResponse([summary]))
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveReport = resolve;
        })
      );
    const onOpen = vi.fn();

    await act(async () => {
      root.render(<ReportLibrary onOpen={onOpen} />);
    });
    await settle();
    expect(container.textContent).toContain("Database nede");

    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Prøv igjen"
    );
    await act(async () => retry?.click());
    await settle();
    expect(container.textContent).toContain("Styrepakke Q3");
    expect(container.textContent).toContain("dataset-v1");

    const open = container.querySelector<HTMLButtonElement>(
      '[aria-label="Åpne rapport Styrepakke Q3"]'
    );
    await act(async () => open?.click());
    expect(container.textContent).toContain("Åpner rapporten");
    expect(open?.disabled).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/reports?id=7", {
      cache: "no-store"
    });

    resolveReport(jsonResponse(report));
    await settle();
    expect(onOpen).toHaveBeenCalledWith(report);
  });
});
