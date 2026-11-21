import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface VercelCronConfig {
  crons?: Array<{
    path: string;
    schedule: string;
  }>;
}

const config = JSON.parse(
  readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")
) as VercelCronConfig;

describe("Vercel cron configuration", () => {
  it("registers both protected maintenance endpoints", () => {
    expect(config.crons).toEqual(
      expect.arrayContaining([
        { path: "/api/cron/daily", schedule: "0 10 * * *" },
        { path: "/api/cron/integrations", schedule: "15 10 * * *" },
      ])
    );
  });

  it("uses unique paths and valid five-field cron expressions", () => {
    const crons = config.crons ?? [];
    const paths = crons.map((cron) => cron.path);

    expect(new Set(paths).size).toBe(paths.length);
    expect(crons.length).toBeGreaterThan(0);

    for (const cron of crons) {
      expect(cron.path.startsWith("/")).toBe(true);
      expect(cron.schedule.trim().split(/\\s+/)).toHaveLength(5);
    }
  });
});
