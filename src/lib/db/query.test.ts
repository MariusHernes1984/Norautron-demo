// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPool: vi.fn()
}));

vi.mock("./pool", () => ({ getPool: mocks.getPool }));
vi.mock("../telemetry", () => ({
  observeSql: vi.fn((_operation: string, action: () => unknown) => action())
}));

import { runGeneratedSql } from "./query";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runGeneratedSql", () => {
  it("returns database rows and driver column metadata", async () => {
    const recordset = Object.assign(
      [{ region: "Norge", net_sales_nok: 10 }],
      { columns: { region: {}, net_sales_nok: {} } }
    );
    const query = vi.fn().mockResolvedValue({ recordset });
    mocks.getPool.mockResolvedValue({
      request: () => ({ query, cancel: vi.fn() })
    });

    await expect(runGeneratedSql("SELECT safe")).resolves.toEqual({
      rows: recordset,
      columns: ["region", "net_sales_nok"]
    });
  });

  it("cancels an in-flight database request when the client disconnects", async () => {
    let rejectQuery: (error: Error) => void = () => undefined;
    const query = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectQuery = reject;
        })
    );
    const cancel = vi.fn(() => rejectQuery(new Error("cancelled")));
    mocks.getPool.mockResolvedValue({
      request: () => ({ query, cancel })
    });
    const controller = new AbortController();

    const pending = runGeneratedSql("SELECT safe", controller.signal);
    await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toThrow("cancelled");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not open a connection for an already aborted request", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runGeneratedSql("SELECT safe", controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.getPool).not.toHaveBeenCalled();
  });
});
