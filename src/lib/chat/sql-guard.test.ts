import { describe, expect, it } from "vitest";
import { validateSelect } from "./sql-guard";

const allowlist = new Map([
  [
    "analytics.erp_sales",
    new Set(["region", "nettosalg_nok", "fakturadato"])
  ],
  ["analytics.quality", new Set(["berort_antall", "defekt_antall"])]
]);

describe("validateSelect", () => {
  it("adds a row cap to an allowlisted query", () => {
    const result = validateSelect(
      "SELECT region, SUM(nettosalg_nok) AS sales FROM analytics.erp_sales GROUP BY region",
      allowlist
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.safe).toContain("TOP (500)");
      expect(result.objects).toEqual(["analytics.erp_sales"]);
    }
  });

  it("preserves a lower TOP and clamps a higher TOP", () => {
    const lower = validateSelect(
      "SELECT TOP (25) region FROM analytics.erp_sales",
      allowlist
    );
    const higher = validateSelect(
      "SELECT TOP 900 region FROM analytics.erp_sales",
      allowlist
    );
    expect(lower).toEqual({
      ok: true,
      safe: "SELECT TOP (25) region FROM analytics.erp_sales",
      objects: ["analytics.erp_sales"]
    });
    expect(higher.ok && higher.safe).toContain("TOP (500)");
    expect(higher.ok && higher.safe).not.toContain("900");
  });

  it("supports aliases, brackets, Unicode strings and COUNT(*)", () => {
    const result = validateSelect(
      "SELECT [e].[region], COUNT(*) AS [orders] FROM [analytics].[erp_sales] AS [e] WHERE [e].[region] = N'Norge' GROUP BY [e].[region];",
      allowlist
    );
    expect(result.ok).toBe(true);
  });

  it("enforces the object-specific column allowlist", () => {
    expect(
      validateSelect(
        "SELECT q.region FROM analytics.quality AS q",
        allowlist
      )
    ).toEqual({
      ok: false,
      reason: "Kolonnen er ikke tillatt for q: region"
    });
  });

  it("requires ambiguous joined columns to use an object alias", () => {
    const joinedAllowlist = new Map(allowlist);
    joinedAllowlist.set(
      "analytics.quality",
      new Set(["region", "berort_antall", "defekt_antall"])
    );
    const result = validateSelect(
      "SELECT region, SUM(q.defekt_antall) AS defects FROM analytics.erp_sales AS e INNER JOIN analytics.quality AS q ON e.region = q.region GROUP BY region",
      joinedAllowlist
    );
    expect(result).toEqual({
      ok: false,
      reason: "Kolonnen må kvalifiseres med tabellalias: region"
    });
  });

  it.each([
    "DELETE FROM analytics.erp_sales",
    "SELECT secret_value FROM analytics.erp_sales",
    "SELECT region FROM dbo.erp_sales",
    "SELECT region FROM erp_sales",
    "SELECT * FROM analytics.erp_sales",
    "SELECT e.* FROM analytics.erp_sales AS e",
    "SELECT region FROM analytics.erp_sales UNION SELECT region FROM analytics.erp_sales",
    "SELECT region FROM (SELECT region FROM analytics.erp_sales) AS nested",
    "SELECT region FROM analytics.erp_sales -- hidden",
    "SELECT region INTO analytics.quality FROM analytics.erp_sales",
    "SELECT region FROM analytics.erp_sales; DROP TABLE analytics.erp_sales"
  ])("rejects unsafe or non-allowlisted SQL: %s", (sql) => {
    expect(validateSelect(sql, allowlist).ok).toBe(false);
  });

  it("allows semicolons and comment markers inside string literals", () => {
    expect(
      validateSelect(
        "SELECT region FROM analytics.erp_sales WHERE region = 'A😀; -- B'",
        allowlist
      ).ok
    ).toBe(true);
  });
});
