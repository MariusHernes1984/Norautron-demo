// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  transactionInput: vi.fn(),
  transactionQuery: vi.fn(),
  releaseInput: vi.fn(),
  releaseQuery: vi.fn(),
  getPool: vi.fn()
}));

vi.mock("mssql", () => {
  class Transaction {
    begin = mocks.begin;
    commit = mocks.commit;
    rollback = mocks.rollback;
  }

  class Request {
    input(...args: unknown[]) {
      mocks.transactionInput(...args);
      return this;
    }

    query(query: string) {
      return mocks.transactionQuery(query);
    }
  }

  return {
    default: {
      Transaction,
      Request,
      ISOLATION_LEVEL: { SERIALIZABLE: "SERIALIZABLE" },
      VarChar: vi.fn((length: number) => ({ type: "varchar", length })),
      UniqueIdentifier: { type: "uniqueidentifier" }
    }
  };
});

vi.mock("./pool", () => ({
  getPool: mocks.getPool
}));

import {
  AI_CALLS_PER_ROLLING_HOUR,
  acquireAiPermit,
  hashClientAddress,
  MAX_CONCURRENT_AI_CALLS
} from "./rate-limit";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.begin.mockResolvedValue(undefined);
  mocks.commit.mockResolvedValue(undefined);
  mocks.rollback.mockResolvedValue(undefined);
  mocks.releaseInput.mockReturnValue(undefined);
  mocks.releaseQuery.mockResolvedValue({ recordset: [] });
  mocks.getPool.mockResolvedValue({
    request: () => ({
      input: mocks.releaseInput,
      query: mocks.releaseQuery
    })
  });
});

describe("distributed AI permits", () => {
  it("uses a keyed one-way hash instead of persisting a raw address", async () => {
    vi.stubEnv("RATE_LIMIT_HMAC_SALT", "s".repeat(64));
    const hash = await hashClientAddress("203.0.113.7");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("203.0.113.7");
    vi.unstubAllEnvs();
  });

  it("uses a rolling hour and global serialized lease cap", async () => {
    mocks.transactionQuery.mockResolvedValue({
      recordset: [{ granted: true, retry_after_seconds: 1 }]
    });

    const permit = await acquireAiPermit("a".repeat(64));
    expect(permit.ok).toBe(true);
    const query = mocks.transactionQuery.mock.calls[0][0] as string;
    expect(query).toContain("sp_getapplock");
    expect(query).toContain("window_started_at > @cutoff");
    expect(query).toContain(`@requests < ${AI_CALLS_PER_ROLLING_HOUR}`);
    expect(query).toContain(`@leases < ${MAX_CONCURRENT_AI_CALLS}`);
    expect(query).toContain("expires_at <= @now");
  });

  it("releases a granted lease idempotently", async () => {
    mocks.transactionQuery.mockResolvedValue({
      recordset: [{ granted: true, retry_after_seconds: 1 }]
    });
    const permit = await acquireAiPermit("b".repeat(64));
    expect(permit.ok).toBe(true);
    if (!permit.ok) return;

    await Promise.all([permit.release(), permit.release()]);
    expect(mocks.releaseQuery).toHaveBeenCalledOnce();
    expect(mocks.releaseQuery).toHaveBeenCalledWith(
      "DELETE FROM app.ai_lease WHERE lease_id = @leaseId"
    );
  });

  it("returns a bounded database-computed retry delay", async () => {
    mocks.transactionQuery.mockResolvedValue({
      recordset: [{ granted: false, retry_after_seconds: 7200 }]
    });

    const permit = await acquireAiPermit("c".repeat(64));
    expect(permit).toEqual({ ok: false, retryAfterSeconds: 3600 });
  });
});
