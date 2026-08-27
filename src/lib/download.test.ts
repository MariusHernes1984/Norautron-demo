import { describe, expect, it } from "vitest";
import {
  calculatePdfPageSlices,
  safePdfBaseName
} from "./download";

describe("PDF pagination", () => {
  it("paginates a document without gaps or overlaps", () => {
    expect(calculatePdfPageSlices(1_750, 700)).toEqual([
      { sourceY: 0, sourceHeight: 700 },
      { sourceY: 700, sourceHeight: 700 },
      { sourceY: 1_400, sourceHeight: 350 }
    ]);
  });

  it("moves bounded data-pdf-avoid blocks to the next page", () => {
    const slices = calculatePdfPageSlices(1_800, 700, [
      { top: 620, bottom: 900 },
      { top: 1_250, bottom: 1_500 }
    ]);

    expect(slices).toEqual([
      { sourceY: 0, sourceHeight: 620 },
      { sourceY: 620, sourceHeight: 630 },
      { sourceY: 1_250, sourceHeight: 550 }
    ]);
  });

  it("splits oversized blocks and sanitizes the downloaded filename", () => {
    expect(
      calculatePdfPageSlices(1_600, 700, [{ top: 100, bottom: 1_500 }])
    ).toHaveLength(3);
    expect(safePdfBaseName("../../Styrepakke Q3.pdf")).toBe(
      "Styrepakke_Q3"
    );
  });
});
