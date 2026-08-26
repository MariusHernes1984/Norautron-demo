import { createHmac, randomUUID } from "node:crypto";
import { SecretClient } from "@azure/keyvault-secrets";
import sql from "mssql";
import { getAzureCredential } from "../azure-credential";
import { logSafeError } from "../http";
import { observeSql } from "../telemetry";
import { getPool } from "./pool";

export const AI_CALLS_PER_ROLLING_HOUR = 60;
export const MAX_CONCURRENT_AI_CALLS = 8;
const LEASE_MINUTES = 5;

let cachedSalt: string | undefined;

async function getSalt() {
  if (cachedSalt) return cachedSalt;
  if (process.env.RATE_LIMIT_HMAC_SALT) {
    cachedSalt = process.env.RATE_LIMIT_HMAC_SALT;
    return cachedSalt;
  }
  const vaultUrl = process.env.AZURE_KEY_VAULT_URL;
  if (!vaultUrl) throw new Error("AZURE_KEY_VAULT_URL is required.");
  const secretName =
    process.env.RATE_LIMIT_SALT_SECRET_NAME || "rate-limit-hmac-salt";
  const secret = await new SecretClient(
    vaultUrl,
    getAzureCredential()
  ).getSecret(secretName);
  if (!secret.value) throw new Error(`Key Vault secret ${secretName} is empty.`);
  cachedSalt = secret.value;
  return cachedSalt;
}

export async function hashClientAddress(address: string) {
  return createHmac("sha256", await getSalt())
    .update(address)
    .digest("hex");
}

export type AiPermit =
  | { ok: true; release: () => Promise<void> }
  | { ok: false; retryAfterSeconds: number };

export async function acquireAiPermit(ipHash: string): Promise<AiPermit> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  const leaseId = randomUUID();

  try {
    const request = new sql.Request(transaction);
    request.input("ipHash", sql.VarChar(64), ipHash);
    request.input("leaseId", sql.UniqueIdentifier, leaseId);
    const result = await observeSql("ai_permit_acquire", () =>
      request.query<{
        granted: boolean;
        retry_after_seconds: number;
      }>(`
      DECLARE @lockResult int;
      EXEC @lockResult = sys.sp_getapplock
        @Resource = N'app.ai-permit',
        @LockMode = N'Exclusive',
        @LockOwner = N'Transaction',
        @LockTimeout = 15000;
      IF @lockResult < 0 THROW 51000, 'AI permit lock unavailable.', 1;

      DECLARE @now datetime2(0) = SYSUTCDATETIME();
      DECLARE @cutoff datetime2(0) = DATEADD(hour, -1, @now);
      DELETE FROM app.ai_lease WHERE expires_at <= @now;
      DELETE FROM app.rate_limit WHERE window_started_at <= @cutoff;

      DECLARE @requests int = COALESCE((
        SELECT SUM(request_count)
        FROM app.rate_limit WITH (UPDLOCK, HOLDLOCK)
        WHERE ip_hash = @ipHash AND window_started_at > @cutoff
      ), 0);
      DECLARE @leases int = (
        SELECT COUNT(*)
        FROM app.ai_lease WITH (UPDLOCK, HOLDLOCK)
      );
      DECLARE @granted bit = 0;
      DECLARE @retryAfter int = 1;

      IF @requests < ${AI_CALLS_PER_ROLLING_HOUR}
        AND @leases < ${MAX_CONCURRENT_AI_CALLS}
      BEGIN
        UPDATE app.rate_limit
        SET request_count = request_count + 1
        WHERE ip_hash = @ipHash AND window_started_at = @now;
        IF @@ROWCOUNT = 0
          INSERT INTO app.rate_limit (ip_hash, window_started_at, request_count)
          VALUES (@ipHash, @now, 1);

        INSERT INTO app.ai_lease (lease_id, ip_hash, expires_at)
        VALUES (@leaseId, @ipHash, DATEADD(minute, ${LEASE_MINUTES}, @now));
        SET @granted = 1;
      END
      ELSE IF @requests >= ${AI_CALLS_PER_ROLLING_HOUR}
      BEGIN
        SELECT @retryAfter = DATEDIFF(
          second,
          @now,
          DATEADD(hour, 1, MIN(window_started_at))
        )
        FROM app.rate_limit
        WHERE ip_hash = @ipHash AND window_started_at > @cutoff;
      END
      ELSE
      BEGIN
        SELECT @retryAfter = DATEDIFF(second, @now, MIN(expires_at))
        FROM app.ai_lease;
      END

      IF @retryAfter IS NULL OR @retryAfter < 1 SET @retryAfter = 1;
      IF @retryAfter > 3600 SET @retryAfter = 3600;
      SELECT @granted AS granted, @retryAfter AS retry_after_seconds;
      `)
    );
    await transaction.commit();
    const state = result.recordset[0];

    if (!state?.granted) {
      return {
        ok: false,
        retryAfterSeconds: Math.max(
          1,
          Math.min(3600, state?.retry_after_seconds ?? 60)
        )
      };
    }

    let releasePromise: Promise<void> | undefined;
    return {
      ok: true,
      release: () =>
        (releasePromise ??= (async () => {
          try {
            const request = (await getPool()).request();
            request.input("leaseId", sql.UniqueIdentifier, leaseId);
            await observeSql("ai_permit_release", () =>
              request.query(
                "DELETE FROM app.ai_lease WHERE lease_id = @leaseId"
              )
            );
          } catch (error) {
            logSafeError("AI lease release failed", error);
          }
        })())
    };
  } catch (error) {
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      logSafeError("AI permit rollback failed", rollbackError);
    }
    throw error;
  }
}
