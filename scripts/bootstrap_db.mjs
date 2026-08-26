import { AzureCliCredential } from "@azure/identity";
import sql from "mssql";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function batches(text) {
  return text
    .split(/^\s*GO\s*$/gim)
    .map((batch) => batch.trim())
    .filter(Boolean);
}

async function fileBatches(path) {
  let text = await readFile(path, "utf8");
  if (basename(path).toLowerCase() === "grants.sql") {
    text = text.replace(/^:setvar.*$/gim, "");
    text = text
      .replaceAll("$(WebIdentityName)", required("AZURE_CONTAINER_APP_NAME"))
      .replaceAll("$(IngestIdentityName)", required("AZURE_INGEST_JOB_NAME"))
      .replaceAll(
        "$(WebIdentityClientId)",
        required("AZURE_CONTAINER_APP_CLIENT_ID")
      )
      .replaceAll(
        "$(IngestIdentityClientId)",
        required("AZURE_INGEST_JOB_CLIENT_ID")
      );
  }
  return batches(text);
}

async function main() {
  const paths = process.argv.slice(2);
  if (!paths.length) {
    throw new Error("Usage: node bootstrap_db.mjs <sql-file> [<sql-file>...]");
  }

  const credential = new AzureCliCredential();
  const accessToken = await credential.getToken(
    "https://database.windows.net/.default"
  );
  if (!accessToken) throw new Error("Could not acquire an Azure SQL access token.");

  const pool = await new sql.ConnectionPool({
    server: required("SQL_SERVER"),
    database: required("SQL_DATABASE"),
    port: 1433,
    connectionTimeout: 30_000,
    requestTimeout: 120_000,
    options: {
      encrypt: true,
      trustServerCertificate: false
    },
    authentication: {
      type: "azure-active-directory-access-token",
      options: { token: accessToken.token }
    }
  }).connect();

  try {
    for (const path of paths) {
      const statements = await fileBatches(path);
      for (const [index, statement] of statements.entries()) {
        try {
          await pool.request().batch(statement);
        } catch (error) {
          throw new Error(`${path} batch ${index + 1} failed`, { cause: error });
        }
      }
      console.log(`Applied ${path}`);
    }
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
