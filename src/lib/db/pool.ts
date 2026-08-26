import sql from "mssql";
import { getAzureCredential } from "../azure-credential";
import { observeSql } from "../telemetry";

let pool: sql.ConnectionPool | undefined;
let tokenExpiresAt = 0;

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export async function getPool() {
  if (pool?.connected && Date.now() < tokenExpiresAt - 5 * 60_000) {
    return pool;
  }
  return observeSql("connect", async () => {
    if (pool) {
      await pool.close();
      pool = undefined;
    }

    const token = await getAzureCredential().getToken(
      "https://database.windows.net/.default"
    );
    if (!token) throw new Error("Could not acquire an Azure SQL access token.");

    pool = await new sql.ConnectionPool({
      server: required("SQL_SERVER"),
      database: required("SQL_DATABASE"),
      port: 1433,
      connectionTimeout: 15_000,
      requestTimeout: 30_000,
      options: {
        encrypt: true,
        trustServerCertificate: false
      },
      authentication: {
        type: "azure-active-directory-access-token",
        options: { token: token.token }
      }
    }).connect();
    tokenExpiresAt = token.expiresOnTimestamp;
    return pool;
  });
}

export function friendlyDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/SQL_SERVER|SQL_DATABASE|required|token/i.test(message)) {
    return "Databasen er ikke konfigurert for dette miljøet.";
  }
  if (/login|principal|authentication|permission/i.test(message)) {
    return "Databasetilgangen ble avvist. Kontroller managed identity og SQL-roller.";
  }
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) {
    return "Databasespørringen tok for lang tid. Prøv et smalere spørsmål.";
  }
  return "Dataanalysen feilet. Prøv igjen eller kontroller datasetstatus.";
}
