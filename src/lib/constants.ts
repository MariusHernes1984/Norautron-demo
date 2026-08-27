import type { KpiTopicId, PipelineStage, ReportSpec } from "./types";

export const PIPELINE_STAGES: Array<{
  id: PipelineStage;
  label: string;
}> = [
  { id: "schema", label: "Forstår datamodellen" },
  { id: "sql", label: "Bygger sikker spørring" },
  { id: "query", label: "Henter og kontrollerer tall" },
  { id: "compose", label: "Skriver analysen" }
];

export const KPI_TOPICS: Array<{
  id: KpiTopicId;
  label: string;
  description: string;
  sourceViews: string[];
  filterDimensions: Array<"period" | "region" | "productFamily" | "factory">;
}> = [
  {
    id: "executive",
    label: "Ledelsesoversikt",
    description: "Salg, margin, pipeline, OEE, kvalitet og leveranse.",
    sourceViews: [
      "metrics.sales_monthly",
      "metrics.production_daily",
      "metrics.pipeline_summary",
      "metrics.quality_summary",
      "metrics.supply_summary"
    ],
    filterDimensions: ["period", "region", "productFamily", "factory"]
  },
  {
    id: "sales",
    label: "Salg og margin",
    description: "Nettosalg, volum og bruttomargin.",
    sourceViews: ["metrics.sales_monthly"],
    filterDimensions: ["period", "region", "productFamily"]
  },
  {
    id: "pipeline",
    label: "CRM-pipeline",
    description: "Åpen vektet verdi, fase og alder.",
    sourceViews: ["metrics.pipeline_summary"],
    filterDimensions: ["period", "region", "productFamily"]
  },
  {
    id: "production",
    label: "Produksjon",
    description: "Godkjent volum, skrapandel og OEE.",
    sourceViews: ["metrics.production_daily"],
    filterDimensions: ["period", "productFamily", "factory"]
  },
  {
    id: "quality",
    label: "Kvalitet",
    description: "Defektrate, avvik og kvalitetskostnad.",
    sourceViews: ["metrics.quality_summary"],
    filterDimensions: ["period", "productFamily", "factory"]
  },
  {
    id: "supply",
    label: "Forsyning",
    description: "Forsinkelser, avvisningsgrad og innkjøpsverdi.",
    sourceViews: ["metrics.supply_summary"],
    filterDimensions: ["period", "productFamily", "factory"]
  }
];

export const DEFAULT_REPORT_SPEC: ReportSpec = {
  topics: ["executive", "sales", "production"],
  language: "no",
  audience: "ledelse",
  filters: {
    regions: [],
    productFamilies: [],
    factories: []
  },
  includeRisks: true,
  includeActions: true,
  includeMethodology: true,
  brief: ""
};

export const CHAT_SUGGESTIONS = [
  "Hvordan har nettosalget og bruttomarginen utviklet seg per år?",
  "Hvilke produktfamilier har lavest OEE og høyest skrap?",
  "Hvor er den største vektede CRM-pipelinen?",
  "Hvilke leverandører har størst forsinkelser og avvisninger?"
];
