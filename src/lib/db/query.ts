import sql from "mssql";
import { observeSql } from "../telemetry";
import type { Row } from "../types";
import { getPool } from "./pool";

export type SqlParameter = {
  name: string;
  type:
    | "nvarchar"
    | "int"
    | "bigint"
    | "datetime2"
    | "bit"
    | "uniqueidentifier";
  value: unknown;
  length?: number;
};

function bind(request: sql.Request, parameter: SqlParameter) {
  const type =
    parameter.type === "nvarchar"
      ? sql.NVarChar(parameter.length === -1 ? sql.MAX : (parameter.length ?? 4000))
      : parameter.type === "int"
        ? sql.Int
        : parameter.type === "bigint"
          ? sql.BigInt
          : parameter.type === "datetime2"
            ? sql.DateTime2
            : parameter.type === "bit"
              ? sql.Bit
              : sql.UniqueIdentifier;
  request.input(parameter.name, type, parameter.value);
}

export async function queryRows<T extends Row = Row>(
  query: string,
  parameters: SqlParameter[] = [],
  operation = "query"
) {
  return observeSql(operation, async () => {
    const request = (await getPool()).request();
    parameters.forEach((parameter) => bind(request, parameter));
    const result = await request.query<T>(query);
    return result.recordset;
  });
}

export async function executeSql(
  query: string,
  parameters: SqlParameter[] = [],
  operation = "execute"
) {
  return observeSql(operation, async () => {
    const request = (await getPool()).request();
    parameters.forEach((parameter) => bind(request, parameter));
    return request.query(query);
  });
}

export async function runGeneratedSql(query: string, signal?: AbortSignal) {
  return observeSql("generated_query", async () => {
    signal?.throwIfAborted();
    const request = (await getPool()).request();
    signal?.throwIfAborted();
    const cancel = () => {
      try {
        request.cancel();
      } catch {
        // The driver may already have completed or cancelled the request.
      }
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const result = await request.query<Row>(query);
      signal?.throwIfAborted();
      return {
        rows: result.recordset,
        columns: Object.keys(result.recordset.columns ?? {})
      };
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  });
}
