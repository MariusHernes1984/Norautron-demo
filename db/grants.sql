:setvar WebIdentityName "ca-norautron-analytics-dev"
:setvar IngestIdentityName "job-norautron-ingest-dev"
:setvar WebIdentityClientId "00000000-0000-0000-0000-000000000000"
:setvar IngestIdentityClientId "00000000-0000-0000-0000-000000000000"

DECLARE @webSidBinary varbinary(16) = CONVERT(
  varbinary(16),
  CONVERT(uniqueidentifier, '$(WebIdentityClientId)')
);
IF EXISTS (
  SELECT 1
  FROM sys.database_principals
  WHERE name = N'$(WebIdentityName)' AND sid <> @webSidBinary
)
  DROP USER [$(WebIdentityName)];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(WebIdentityName)')
BEGIN
  DECLARE @webSid varchar(34) = CONVERT(
    varchar(34),
    @webSidBinary,
    1
  );
  EXEC(N'CREATE USER [$(WebIdentityName)] WITH SID = ' + @webSid + N', TYPE = E');
END;
DECLARE @ingestSidBinary varbinary(16) = CONVERT(
  varbinary(16),
  CONVERT(uniqueidentifier, '$(IngestIdentityClientId)')
);
IF EXISTS (
  SELECT 1
  FROM sys.database_principals
  WHERE name = N'$(IngestIdentityName)' AND sid <> @ingestSidBinary
)
  DROP USER [$(IngestIdentityName)];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(IngestIdentityName)')
BEGIN
  DECLARE @ingestSid varchar(34) = CONVERT(
    varchar(34),
    @ingestSidBinary,
    1
  );
  EXEC(N'CREATE USER [$(IngestIdentityName)] WITH SID = ' + @ingestSid + N', TYPE = E');
END;
GO

GRANT SELECT ON SCHEMA::analytics TO [$(WebIdentityName)];
GRANT SELECT ON SCHEMA::metrics TO [$(WebIdentityName)];
GRANT SELECT, INSERT ON app.report TO [$(WebIdentityName)];
GRANT SELECT, INSERT ON app.usage_log TO [$(WebIdentityName)];
GRANT SELECT, INSERT, UPDATE, DELETE ON app.rate_limit TO [$(WebIdentityName)];
GRANT SELECT, INSERT, UPDATE, DELETE ON app.ai_lease TO [$(WebIdentityName)];
GRANT SELECT ON app.dataset_version TO [$(WebIdentityName)];

GRANT SELECT, INSERT, UPDATE ON app.dataset_version TO [$(IngestIdentityName)];
GRANT SELECT, INSERT, DELETE ON SCHEMA::staging TO [$(IngestIdentityName)];
GRANT INSERT ON SCHEMA::raw TO [$(IngestIdentityName)];
GO
