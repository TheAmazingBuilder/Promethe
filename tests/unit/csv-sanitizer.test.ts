import { describe, expect, it } from "vitest";
import { escapeCsvField } from "@/lib/csv";
import { buildErrorReportCsv } from "@/hooks/use-import";

describe("spreadsheet-safe CSV exports", () => {
  it("neutralizes formula prefixes after leading whitespace and control characters", () => {
    expect(escapeCsvField("=1+1")).toBe("\"'=1+1\"");
    expect(escapeCsvField("+SUM(1,2)")).toBe("\"'+SUM(1,2)\"");
    expect(escapeCsvField("\t@SUM(1,2)")).toBe("\"'\t@SUM(1,2)\"");
    expect(escapeCsvField("-1+cmd|payload")).toBe("\"'-1+cmd|payload\"");
  });

  it("quotes and escapes embedded quotes using RFC 4180 rules", () => {
    expect(escapeCsvField('a,"b"')).toBe('"a,""b"""');
  });

  it("protects untrusted import identifiers and details in the downloadable report", () => {
    const csv = buildErrorReportCsv([
      {
        row: 1,
        externalId: '=HYPERLINK("https://example.invalid","Open")',
        code: "INVALID_ROW",
        detail: "\t+cmd|/C calc",
      },
    ]);

    expect(csv).toContain("\"'=HYPERLINK(\"\"https://example.invalid\"\",\"\"Open\"\")\"");
    expect(csv).toContain("\"\t'+cmd|/C calc\"");
    expect(csv.startsWith('"row","externalId","code","detail"')).toBe(true);
  });
});
