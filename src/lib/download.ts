"use client";

export type PdfAvoidRange = {
  top: number;
  bottom: number;
};

export type PdfPageSlice = {
  sourceY: number;
  sourceHeight: number;
};

export function safePdfBaseName(name: string) {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9-_]+/gi, "_")
      .replace(/^_+|_+$/g, "") || "rapport"
  );
}

export function calculatePdfPageSlices(
  totalHeight: number,
  pageHeight: number,
  avoidRanges: PdfAvoidRange[] = []
): PdfPageSlice[] {
  if (
    !Number.isFinite(totalHeight) ||
    !Number.isFinite(pageHeight) ||
    totalHeight <= 0 ||
    pageHeight <= 0
  ) {
    throw new Error("Ugyldige PDF-dimensjoner.");
  }

  const ranges = avoidRanges
    .map(({ top, bottom }) => ({
      top: Math.max(0, Math.min(totalHeight, Math.floor(top))),
      bottom: Math.max(0, Math.min(totalHeight, Math.ceil(bottom)))
    }))
    .filter(({ top, bottom }) => bottom > top)
    .sort((left, right) => left.top - right.top);
  const slices: PdfPageSlice[] = [];
  let sourceY = 0;

  while (sourceY < totalHeight) {
    const target = Math.min(totalHeight, sourceY + pageHeight);
    let end = target;

    if (target < totalHeight) {
      const crossingRange = ranges.find(
        (range) =>
          range.top > sourceY &&
          range.top < target &&
          range.bottom > target &&
          range.bottom - range.top <= pageHeight
      );
      if (crossingRange) end = crossingRange.top;
    }

    if (end <= sourceY) end = target;
    slices.push({ sourceY, sourceHeight: end - sourceY });
    sourceY = end;
  }

  return slices;
}

function pdfAvoidRanges(element: HTMLElement, canvasHeight: number) {
  const rootRect = element.getBoundingClientRect();
  const layoutHeight = Math.max(element.scrollHeight, rootRect.height, 1);
  const scaleY = canvasHeight / layoutHeight;
  return Array.from(
    element.querySelectorAll<HTMLElement>("[data-pdf-avoid]")
  ).map((item) => {
    const rect = item.getBoundingClientRect();
    return {
      top: (rect.top - rootRect.top) * scaleY,
      bottom: (rect.bottom - rootRect.top) * scaleY
    };
  });
}

export async function downloadElementAsPdf(
  element: HTMLElement,
  baseName: string,
  meta?: { title?: string; date?: string }
) {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import("html2canvas-pro"),
    import("jspdf")
  ]);
  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false
  });
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const marginX = 24;
  const marginTop = 42;
  const marginBottom = 34;
  const usableWidth = pageWidth - marginX * 2;
  const usableHeight = pageHeight - marginTop - marginBottom;
  const pageHeightPx = Math.floor(usableHeight * (canvas.width / usableWidth));
  const slices = calculatePdfPageSlices(
    canvas.height,
    pageHeightPx,
    pdfAvoidRanges(element, canvas.height)
  );
  const pageCount = slices.length;
  const title = (meta?.title ?? baseName).slice(0, 70);
  const date = new Date(meta?.date ?? Date.now()).toLocaleDateString("nb-NO");

  for (let page = 0; page < slices.length; page += 1) {
    if (page > 0) pdf.addPage();
    const { sourceY, sourceHeight } = slices[page];
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = sourceHeight;
    const context = slice.getContext("2d");
    if (!context) throw new Error("Kunne ikke opprette PDF-side.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, slice.width, slice.height);
    context.drawImage(
      canvas,
      0,
      sourceY,
      canvas.width,
      sourceHeight,
      0,
      0,
      canvas.width,
      sourceHeight
    );
    const imageHeight = (sourceHeight * usableWidth) / canvas.width;
    pdf.addImage(
      slice,
      "PNG",
      marginX,
      marginTop,
      usableWidth,
      imageHeight,
      undefined,
      "FAST"
    );
    pdf.setFillColor(0, 138, 0);
    pdf.rect(marginX, 17, 18, 3, "F");
    pdf.setFontSize(8);
    pdf.setTextColor(40, 45, 47);
    pdf.text("Norautron Analytics", marginX + 24, 21);
    pdf.setTextColor(90);
    pdf.text(title, pageWidth - marginX, 21, { align: "right" });
    pdf.setDrawColor(0, 138, 0);
    pdf.line(marginX, 29, pageWidth - marginX, 29);
    pdf.setDrawColor(225);
    pdf.line(marginX, pageHeight - 26, pageWidth - marginX, pageHeight - 26);
    pdf.setFontSize(7.5);
    pdf.setTextColor(100);
    pdf.text("Norautron Analytics", marginX, pageHeight - 16);
    pdf.text(date, pageWidth / 2, pageHeight - 16, { align: "center" });
    pdf.text(
      `Side ${page + 1} av ${pageCount}`,
      pageWidth - marginX,
      pageHeight - 16,
      { align: "right" }
    );
  }
  pdf.save(`${safePdfBaseName(baseName)}.pdf`);
}
