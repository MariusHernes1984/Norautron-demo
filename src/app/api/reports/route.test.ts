// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getReport: vi.fn(),
  listReports: vi.fn(),
  friendlyDatabaseError: vi.fn(() => "Databasen er utilgjengelig.")
}));

vi.mock("@/lib/db/reports", () => ({
  getReport: mocks.getReport,
  listReports: mocks.listReports
}));
vi.mock("@/lib/db/pool", () => ({
  friendlyDatabaseError: mocks.friendlyDatabaseError
}));
vi.mock("@/lib/http", () => ({
  withRequestTelemetry: (
    _request: NextRequest,
    _route: string,
    handler: (context: { requestId: string }) => Promise<Response>
  ) => handler({ requestId: "request-test" })
}));

import { GET, parsePositiveReportId } from "./route";

function request(query = "") {
  return new NextRequest(`https://pilot.example/api/reports${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("read-only report route", () => {
  it("lists reports with private response caching disabled", async () => {
    mocks.listReports.mockResolvedValue([{ id: 2, title: "Rapport" }]);
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual([
      { id: 2, title: "Rapport" }
    ]);
    expect(mocks.getReport).not.toHaveBeenCalled();
  });

  it.each(["", "0", "-1", "1.5", "1e2", " 1", "9007199254740992"])(
    "rejects invalid report ID %j",
    async (id) => {
      const response = await GET(request(`?id=${encodeURIComponent(id)}`));
      expect(response.status).toBe(400);
      expect(mocks.getReport).not.toHaveBeenCalled();
    }
  );

  it("fetches a validated positive report ID and returns 404 when absent", async () => {
    mocks.getReport.mockResolvedValueOnce({ id: 12, title: "Årsrapport" });
    const found = await GET(request("?id=12"));
    expect(found.status).toBe(200);
    expect(mocks.getReport).toHaveBeenCalledWith(12);

    mocks.getReport.mockResolvedValueOnce(null);
    const missing = await GET(request("?id=13"));
    expect(missing.status).toBe(404);
  });

  it("maps database errors without exposing details", async () => {
    mocks.listReports.mockRejectedValue(new Error("secret connection string"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Databasen er utilgjengelig."
    });
  });

  it("parses only safe positive decimal IDs", () => {
    expect(parsePositiveReportId("42")).toBe(42);
    expect(parsePositiveReportId("01")).toBeNull();
  });
});
