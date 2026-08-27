SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF SCHEMA_ID(N'raw') IS NULL EXEC(N'CREATE SCHEMA raw');
IF SCHEMA_ID(N'staging') IS NULL EXEC(N'CREATE SCHEMA staging');
IF SCHEMA_ID(N'analytics') IS NULL EXEC(N'CREATE SCHEMA analytics');
IF SCHEMA_ID(N'metrics') IS NULL EXEC(N'CREATE SCHEMA metrics');
IF SCHEMA_ID(N'app') IS NULL EXEC(N'CREATE SCHEMA app');

IF OBJECT_ID(N'app.dataset_version', N'U') IS NULL
CREATE TABLE app.dataset_version (
  version_id uniqueidentifier NOT NULL PRIMARY KEY,
  blob_name nvarchar(300) NOT NULL,
  blob_etag nvarchar(200) NOT NULL,
  sha256 char(64) NOT NULL,
  file_size_bytes bigint NOT NULL,
  status nvarchar(20) NOT NULL
    CONSTRAINT CK_dataset_version_status
    CHECK (status IN (N'loading', N'staged', N'active', N'archived', N'failed')),
  total_rows int NULL,
  source_row_counts nvarchar(max) NULL,
  validated_at datetime2(0) NULL,
  loaded_at datetime2(0) NULL,
  error_message nvarchar(2000) NULL,
  created_at datetime2(0) NOT NULL
    CONSTRAINT DF_dataset_version_created DEFAULT SYSUTCDATETIME()
);

IF COL_LENGTH(N'app.dataset_version', N'source_row_counts') IS NULL
  ALTER TABLE app.dataset_version ADD source_row_counts nvarchar(max) NULL;
IF COL_LENGTH(N'app.dataset_version', N'validated_at') IS NULL
  ALTER TABLE app.dataset_version ADD validated_at datetime2(0) NULL;

IF OBJECT_ID(N'app.CK_dataset_version_status', N'C') IS NOT NULL
  ALTER TABLE app.dataset_version DROP CONSTRAINT CK_dataset_version_status;
ALTER TABLE app.dataset_version WITH CHECK ADD CONSTRAINT CK_dataset_version_status
  CHECK (status IN (N'loading', N'staged', N'active', N'archived', N'failed'));

IF OBJECT_ID(N'app.CK_dataset_version_source_counts', N'C') IS NULL
  ALTER TABLE app.dataset_version WITH CHECK ADD CONSTRAINT CK_dataset_version_source_counts
    CHECK (source_row_counts IS NULL OR ISJSON(source_row_counts) = 1);

IF OBJECT_ID(N'raw.production', N'U') IS NULL
CREATE TABLE raw.production (
  dataset_version uniqueidentifier NOT NULL,
  produksjons_id nvarchar(40) NOT NULL,
  fabrikk nvarchar(80) NULL,
  produksjonslinje nvarchar(80) NULL,
  skift nvarchar(40) NULL,
  produksjonsdato date NULL,
  starttid datetime2(0) NULL,
  sluttid datetime2(0) NULL,
  arbeidsordre nvarchar(60) NULL,
  erp_ordre_id nvarchar(60) NULL,
  crm_mulighet_id nvarchar(60) NULL,
  produkt_id nvarchar(40) NULL,
  produktfamilie nvarchar(100) NULL,
  produktnavn nvarchar(200) NULL,
  kunde_id nvarchar(40) NULL,
  kunde nvarchar(200) NULL,
  planlagt_antall int NULL,
  produsert_antall int NULL,
  godkjent_antall int NULL,
  skrap_antall int NULL,
  omstilling_min int NULL,
  syklustid_sek decimal(18,4) NULL,
  planlagt_syklustid_sek decimal(18,4) NULL,
  maskin_utnyttelse_pct decimal(12,8) NULL,
  oee_pct decimal(12,8) NULL,
  energiforbruk_kwh decimal(18,4) NULL,
  operatorteam nvarchar(80) NULL,
  produksjonsstatus nvarchar(80) NULL,
  CONSTRAINT PK_raw_production PRIMARY KEY (dataset_version, produksjons_id),
  CONSTRAINT FK_raw_production_version FOREIGN KEY (dataset_version)
    REFERENCES app.dataset_version(version_id)
);

IF OBJECT_ID(N'raw.erp_sales', N'U') IS NULL
CREATE TABLE raw.erp_sales (
  dataset_version uniqueidentifier NOT NULL,
  fakturadato date NULL,
  faktura_id nvarchar(60) NOT NULL,
  erp_ordre_id nvarchar(60) NULL,
  ordrelinje int NULL,
  kunde_id nvarchar(40) NULL,
  kunde nvarchar(200) NULL,
  segment nvarchar(100) NULL,
  land nvarchar(20) NULL,
  region nvarchar(100) NULL,
  salgskanal nvarchar(100) NULL,
  selger nvarchar(100) NULL,
  produkt_id nvarchar(40) NULL,
  produktfamilie nvarchar(100) NULL,
  produktnavn nvarchar(200) NULL,
  antall int NULL,
  enhetspris_nok decimal(19,4) NULL,
  rabattsats_pct decimal(12,8) NULL,
  bruttosalg_nok decimal(19,4) NULL,
  rabatt_nok decimal(19,4) NULL,
  nettosalg_nok decimal(19,4) NULL,
  cogs_nok decimal(19,4) NULL,
  bruttomargin_nok decimal(19,4) NULL,
  bruttomargin_pct decimal(12,8) NULL,
  betalingsbetingelse nvarchar(80) NULL,
  betalingsstatus nvarchar(80) NULL,
  crm_mulighet_id nvarchar(60) NULL,
  CONSTRAINT PK_raw_erp_sales PRIMARY KEY (dataset_version, faktura_id),
  CONSTRAINT FK_raw_erp_sales_version FOREIGN KEY (dataset_version)
    REFERENCES app.dataset_version(version_id)
);

IF OBJECT_ID(N'raw.crm_pipeline', N'U') IS NULL
CREATE TABLE raw.crm_pipeline (
  dataset_version uniqueidentifier NOT NULL,
  crm_mulighet_id nvarchar(60) NOT NULL,
  kunde_id nvarchar(40) NULL,
  kunde nvarchar(200) NULL,
  segment nvarchar(100) NULL,
  region nvarchar(100) NULL,
  eier nvarchar(100) NULL,
  salgsfase nvarchar(100) NULL,
  sannsynlighet_pct decimal(12,8) NULL,
  estimert_verdi_nok decimal(19,4) NULL,
  vektet_verdi_nok decimal(19,4) NULL,
  produktfamilie nvarchar(100) NULL,
  losningstype nvarchar(100) NULL,
  opprettet_dato date NULL,
  forventet_lukkedato date NULL,
  neste_aktivitet date NULL,
  dager_i_pipeline int NULL,
  konkurrent nvarchar(100) NULL,
  avslutningsgrunn nvarchar(150) NULL,
  status nvarchar(40) NULL,
  lead_kilde nvarchar(100) NULL,
  kvalifiseringsscore int NULL,
  erp_ordre_id nvarchar(60) NULL,
  sist_oppdatert datetime2(0) NULL,
  CONSTRAINT PK_raw_crm_pipeline PRIMARY KEY (dataset_version, crm_mulighet_id),
  CONSTRAINT FK_raw_crm_pipeline_version FOREIGN KEY (dataset_version)
    REFERENCES app.dataset_version(version_id)
);

IF OBJECT_ID(N'raw.quality', N'U') IS NULL
CREATE TABLE raw.quality (
  dataset_version uniqueidentifier NOT NULL,
  avviks_id nvarchar(60) NOT NULL,
  registrert_tid datetime2(0) NULL,
  fabrikk nvarchar(80) NULL,
  produksjonslinje nvarchar(80) NULL,
  skift nvarchar(40) NULL,
  arbeidsordre nvarchar(60) NULL,
  produkt_id nvarchar(40) NULL,
  produktfamilie nvarchar(100) NULL,
  kunde_id nvarchar(40) NULL,
  leverandor_id nvarchar(40) NULL,
  avvikskategori nvarchar(100) NULL,
  feilkode nvarchar(40) NULL,
  alvorlighet nvarchar(40) NULL,
  oppdaget_ved nvarchar(100) NULL,
  berort_antall int NULL,
  defekt_antall int NULL,
  defektrate_pct decimal(12,8) NULL,
  kostnad_nok decimal(19,4) NULL,
  rotarsaksstatus nvarchar(100) NULL,
  korrigerende_tiltak nvarchar(200) NULL,
  ansvarlig_team nvarchar(100) NULL,
  forfallsdato date NULL,
  lukket_dato date NULL,
  status nvarchar(60) NULL,
  erp_ordre_id nvarchar(60) NULL,
  CONSTRAINT PK_raw_quality PRIMARY KEY (dataset_version, avviks_id),
  CONSTRAINT FK_raw_quality_version FOREIGN KEY (dataset_version)
    REFERENCES app.dataset_version(version_id)
);

IF OBJECT_ID(N'raw.supply', N'U') IS NULL
CREATE TABLE raw.supply (
  dataset_version uniqueidentifier NOT NULL,
  bevegelse_id nvarchar(60) NOT NULL,
  dato date NULL,
  fabrikk nvarchar(80) NULL,
  lagerlokasjon nvarchar(80) NULL,
  leverandor_id nvarchar(40) NULL,
  leverandor nvarchar(200) NULL,
  leverandorland nvarchar(20) NULL,
  innkjopsordre nvarchar(60) NULL,
  po_linje int NULL,
  produkt_id nvarchar(40) NULL,
  produktfamilie nvarchar(100) NULL,
  produktnavn nvarchar(200) NULL,
  bevegelsestype nvarchar(100) NULL,
  bestilt_antall int NULL,
  mottatt_antall int NULL,
  avvist_antall int NULL,
  enhet nvarchar(20) NULL,
  standard_ledetid_dager int NULL,
  faktisk_ledetid_dager int NULL,
  forsinkelse_dager int NULL,
  enhetskost_nok decimal(19,4) NULL,
  totalkost_nok decimal(19,4) NULL,
  incoterm nvarchar(20) NULL,
  transportmodus nvarchar(60) NULL,
  lagerstatus nvarchar(60) NULL,
  erp_ordre_id nvarchar(60) NULL,
  CONSTRAINT PK_raw_supply PRIMARY KEY (dataset_version, bevegelse_id),
  CONSTRAINT FK_raw_supply_version FOREIGN KEY (dataset_version)
    REFERENCES app.dataset_version(version_id)
);

IF OBJECT_ID(N'staging.production', N'U') IS NULL
BEGIN
  SELECT TOP (0) * INTO staging.production FROM raw.production;
  CREATE UNIQUE CLUSTERED INDEX CIX_staging_production
    ON staging.production(dataset_version, produksjons_id);
END;

IF OBJECT_ID(N'staging.erp_sales', N'U') IS NULL
BEGIN
  SELECT TOP (0) * INTO staging.erp_sales FROM raw.erp_sales;
  CREATE UNIQUE CLUSTERED INDEX CIX_staging_erp_sales
    ON staging.erp_sales(dataset_version, faktura_id);
END;

IF OBJECT_ID(N'staging.crm_pipeline', N'U') IS NULL
BEGIN
  SELECT TOP (0) * INTO staging.crm_pipeline FROM raw.crm_pipeline;
  CREATE UNIQUE CLUSTERED INDEX CIX_staging_crm_pipeline
    ON staging.crm_pipeline(dataset_version, crm_mulighet_id);
END;

IF OBJECT_ID(N'staging.quality', N'U') IS NULL
BEGIN
  SELECT TOP (0) * INTO staging.quality FROM raw.quality;
  CREATE UNIQUE CLUSTERED INDEX CIX_staging_quality
    ON staging.quality(dataset_version, avviks_id);
END;

IF OBJECT_ID(N'staging.supply', N'U') IS NULL
BEGIN
  SELECT TOP (0) * INTO staging.supply FROM raw.supply;
  CREATE UNIQUE CLUSTERED INDEX CIX_staging_supply
    ON staging.supply(dataset_version, bevegelse_id);
END;

IF OBJECT_ID(N'app.report', N'U') IS NULL
CREATE TABLE app.report (
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  title nvarchar(200) NOT NULL,
  report_json nvarchar(max) NOT NULL,
  report_schema_version int NOT NULL
    CONSTRAINT DF_report_schema_version DEFAULT 1,
  spec_json nvarchar(max) NOT NULL,
  dataset_version nvarchar(100) NOT NULL,
  model_deployment nvarchar(100) NOT NULL,
  created_at datetime2(0) NOT NULL
    CONSTRAINT DF_report_created DEFAULT SYSUTCDATETIME()
);

IF COL_LENGTH(N'app.report', N'report_schema_version') IS NULL
  ALTER TABLE app.report ADD report_schema_version int NOT NULL
    CONSTRAINT DF_report_schema_version DEFAULT 1 WITH VALUES;
IF OBJECT_ID(N'app.CK_report_schema_version', N'C') IS NULL
  ALTER TABLE app.report WITH CHECK ADD CONSTRAINT CK_report_schema_version
    CHECK (report_schema_version = 1);
IF OBJECT_ID(N'app.CK_report_json', N'C') IS NULL
  ALTER TABLE app.report WITH CHECK ADD CONSTRAINT CK_report_json
    CHECK (ISJSON(report_json) = 1);
IF OBJECT_ID(N'app.CK_report_spec_json', N'C') IS NULL
  ALTER TABLE app.report WITH CHECK ADD CONSTRAINT CK_report_spec_json
    CHECK (ISJSON(spec_json) = 1);

IF OBJECT_ID(N'app.usage_log', N'U') IS NULL
CREATE TABLE app.usage_log (
  id bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
  kind nvarchar(20) NOT NULL,
  deployment nvarchar(100) NOT NULL,
  input_tokens int NOT NULL,
  output_tokens int NOT NULL,
  total_tokens int NOT NULL,
  succeeded bit NOT NULL,
  created_at datetime2(0) NOT NULL
    CONSTRAINT DF_usage_created DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID(N'app.rate_limit', N'U') IS NULL
CREATE TABLE app.rate_limit (
  ip_hash varchar(64) NOT NULL,
  window_started_at datetime2(0) NOT NULL,
  request_count int NOT NULL,
  CONSTRAINT PK_rate_limit PRIMARY KEY (ip_hash, window_started_at)
);

IF OBJECT_ID(N'app.ai_lease', N'U') IS NULL
CREATE TABLE app.ai_lease (
  lease_id uniqueidentifier NOT NULL PRIMARY KEY,
  ip_hash varchar(64) NOT NULL,
  expires_at datetime2(0) NOT NULL
);

COMMIT TRANSACTION;
GO

CREATE OR ALTER VIEW analytics.production AS
SELECT p.*
FROM raw.production AS p
INNER JOIN app.dataset_version AS v
  ON v.version_id = p.dataset_version AND v.status = N'active';
GO

CREATE OR ALTER VIEW analytics.erp_sales AS
SELECT e.*
FROM raw.erp_sales AS e
INNER JOIN app.dataset_version AS v
  ON v.version_id = e.dataset_version AND v.status = N'active';
GO

CREATE OR ALTER VIEW analytics.crm_pipeline AS
SELECT c.*
FROM raw.crm_pipeline AS c
INNER JOIN app.dataset_version AS v
  ON v.version_id = c.dataset_version AND v.status = N'active';
GO

CREATE OR ALTER VIEW analytics.quality AS
SELECT q.*
FROM raw.quality AS q
INNER JOIN app.dataset_version AS v
  ON v.version_id = q.dataset_version AND v.status = N'active';
GO

CREATE OR ALTER VIEW analytics.supply AS
SELECT s.*
FROM raw.supply AS s
INNER JOIN app.dataset_version AS v
  ON v.version_id = s.dataset_version AND v.status = N'active';
GO

CREATE OR ALTER VIEW metrics.executive_kpis AS
SELECT
  (SELECT SUM(nettosalg_nok) FROM analytics.erp_sales) AS net_sales_nok,
  (SELECT SUM(bruttomargin_nok) FROM analytics.erp_sales) AS gross_margin_nok,
  (SELECT SUM(bruttomargin_nok) / NULLIF(SUM(nettosalg_nok), 0)
    FROM analytics.erp_sales) AS gross_margin_pct,
  (SELECT SUM(godkjent_antall) FROM analytics.production) AS approved_units,
  (SELECT AVG(oee_pct) FROM analytics.production) AS oee_pct,
  (SELECT SUM(CAST(defekt_antall AS decimal(19,4))) /
    NULLIF(SUM(CAST(berort_antall AS decimal(19,4))), 0)
    FROM analytics.quality) AS defect_rate_pct,
  (SELECT SUM(vektet_verdi_nok) FROM analytics.crm_pipeline
    WHERE status = N'Apen') AS weighted_open_pipeline_nok,
  (SELECT AVG(CAST(forsinkelse_dager AS decimal(19,4)))
    FROM analytics.supply) AS supplier_delay_days,
  (SELECT TOP (1) CONVERT(nvarchar(36), version_id)
    FROM app.dataset_version WHERE status = N'active') AS dataset_version;
GO

CREATE OR ALTER VIEW metrics.sales_monthly AS
SELECT
  DATEFROMPARTS(YEAR(fakturadato), MONTH(fakturadato), 1) AS [month],
  region,
  segment,
  produktfamilie AS product_family,
  SUM(nettosalg_nok) AS net_sales_nok,
  SUM(bruttomargin_nok) AS gross_margin_nok,
  SUM(bruttomargin_nok) / NULLIF(SUM(nettosalg_nok), 0) AS gross_margin_pct,
  SUM(antall) AS units
FROM analytics.erp_sales
GROUP BY
  DATEFROMPARTS(YEAR(fakturadato), MONTH(fakturadato), 1),
  region, segment, produktfamilie;
GO

CREATE OR ALTER VIEW metrics.production_daily AS
SELECT
  produksjonsdato AS production_date,
  fabrikk AS factory,
  produksjonslinje AS production_line,
  skift AS shift,
  produktfamilie AS product_family,
  SUM(planlagt_antall) AS planned_units,
  SUM(produsert_antall) AS produced_units,
  SUM(godkjent_antall) AS approved_units,
  SUM(skrap_antall) AS scrap_units,
  AVG(oee_pct) AS oee_pct,
  SUM(COALESCE(oee_pct, 0)) AS oee_total,
  COUNT_BIG(oee_pct) AS oee_observation_count,
  AVG(maskin_utnyttelse_pct) AS utilization_pct,
  SUM(energiforbruk_kwh) AS energy_kwh
FROM analytics.production
GROUP BY
  produksjonsdato, fabrikk, produksjonslinje, skift, produktfamilie;
GO

CREATE OR ALTER VIEW metrics.pipeline_summary AS
SELECT
  DATEFROMPARTS(
    YEAR(forventet_lukkedato),
    MONTH(forventet_lukkedato),
    1
  ) AS expected_close_month,
  salgsfase AS sales_stage,
  status,
  region,
  segment,
  produktfamilie AS product_family,
  COUNT_BIG(*) AS opportunity_count,
  SUM(estimert_verdi_nok) AS estimated_value_nok,
  SUM(vektet_verdi_nok) AS weighted_value_nok,
  AVG(CAST(dager_i_pipeline AS decimal(19,4))) AS average_days_in_pipeline,
  SUM(COALESCE(CAST(dager_i_pipeline AS decimal(19,4)), 0))
    AS pipeline_days_total,
  COUNT_BIG(dager_i_pipeline) AS pipeline_days_observation_count
FROM analytics.crm_pipeline
GROUP BY
  DATEFROMPARTS(
    YEAR(forventet_lukkedato),
    MONTH(forventet_lukkedato),
    1
  ),
  salgsfase, status, region, segment, produktfamilie;
GO

CREATE OR ALTER VIEW metrics.quality_summary AS
SELECT
  DATEFROMPARTS(YEAR(registrert_tid), MONTH(registrert_tid), 1) AS registered_month,
  fabrikk AS factory,
  produksjonslinje AS production_line,
  produktfamilie AS product_family,
  leverandor_id AS supplier_id,
  alvorlighet AS severity,
  avvikskategori AS deviation_category,
  COUNT_BIG(*) AS deviation_count,
  SUM(berort_antall) AS affected_units,
  SUM(defekt_antall) AS defect_units,
  SUM(CAST(defekt_antall AS decimal(19,4))) /
    NULLIF(SUM(CAST(berort_antall AS decimal(19,4))), 0) AS defect_rate_pct,
  SUM(kostnad_nok) AS quality_cost_nok
FROM analytics.quality
GROUP BY
  DATEFROMPARTS(YEAR(registrert_tid), MONTH(registrert_tid), 1),
  fabrikk, produksjonslinje, produktfamilie, leverandor_id,
  alvorlighet, avvikskategori;
GO

CREATE OR ALTER VIEW metrics.supply_summary AS
SELECT
  DATEFROMPARTS(YEAR(dato), MONTH(dato), 1) AS movement_month,
  fabrikk AS factory,
  leverandor_id AS supplier_id,
  leverandor AS supplier,
  leverandorland AS supplier_country,
  produktfamilie AS product_family,
  COUNT_BIG(*) AS movement_count,
  SUM(bestilt_antall) AS ordered_units,
  SUM(mottatt_antall) AS received_units,
  SUM(avvist_antall) AS rejected_units,
  AVG(CAST(forsinkelse_dager AS decimal(19,4))) AS average_delay_days,
  SUM(COALESCE(CAST(forsinkelse_dager AS decimal(19,4)), 0))
    AS delay_day_total,
  COUNT_BIG(forsinkelse_dager) AS delay_observation_count,
  SUM(totalkost_nok) AS total_cost_nok
FROM analytics.supply
GROUP BY
  DATEFROMPARTS(YEAR(dato), MONTH(dato), 1),
  fabrikk, leverandor_id, leverandor, leverandorland, produktfamilie;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_dataset_version_status')
  CREATE INDEX IX_dataset_version_status
    ON app.dataset_version(status, loaded_at DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_dataset_version_active')
  CREATE UNIQUE INDEX UX_dataset_version_active
    ON app.dataset_version(status)
    WHERE status = N'active';
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_report_created_at')
  CREATE INDEX IX_report_created_at
    ON app.report(created_at DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ai_lease_expires')
  CREATE INDEX IX_ai_lease_expires
    ON app.ai_lease(expires_at);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_rate_limit_window')
  CREATE INDEX IX_rate_limit_window
    ON app.rate_limit(window_started_at);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_raw_erp_sales_date')
  CREATE INDEX IX_raw_erp_sales_date
    ON raw.erp_sales(dataset_version, fakturadato);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_raw_production_date')
  CREATE INDEX IX_raw_production_date
    ON raw.production(dataset_version, produksjonsdato);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_raw_quality_time')
  CREATE INDEX IX_raw_quality_time
    ON raw.quality(dataset_version, registrert_tid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_raw_supply_date')
  CREATE INDEX IX_raw_supply_date
    ON raw.supply(dataset_version, dato);
GO
