import { z } from "zod";

export const monteCarloInputSchema = z
  .object({
    accountId: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(80).default("Monte Carlo simulation"),
    source: z.enum(["HISTORICAL", "HYPOTHETICAL"]).default("HISTORICAL"),
    riskPercent: z.number().min(0.1).max(10).default(1),
    iterations: z.number().int().min(100).max(10000).default(2000),
    tradesPerPath: z.number().int().min(10).max(500).default(100),
    targetPercent: z.number().min(0.1).max(500).default(10),
    ruinThresholdPercent: z.number().min(1).max(99).default(30),
    ruinBehavior: z.enum(["STOP", "CONTINUE"]).default("STOP"),
    hypotheticalWinRate: z.number().min(0).max(100).optional(),
    hypotheticalAvgWinR: z.number().min(0.1).max(20).optional(),
    hypotheticalAvgLossR: z.number().min(-20).max(-0.1).optional(),
    seed: z.number().int().min(0).max(4294967295).default(42),
  })
  .superRefine((value, ctx) => {
    if (value.source !== "HYPOTHETICAL") return;
    if (value.hypotheticalWinRate == null) {
      ctx.addIssue({
        code: "custom",
        path: ["hypotheticalWinRate"],
        message: "Win rate is required for a hypothetical simulation.",
      });
    }
    if (value.hypotheticalAvgWinR == null) {
      ctx.addIssue({
        code: "custom",
        path: ["hypotheticalAvgWinR"],
        message: "Average win is required for a hypothetical simulation.",
      });
    }
    if (value.hypotheticalAvgLossR == null) {
      ctx.addIssue({
        code: "custom",
        path: ["hypotheticalAvgLossR"],
        message: "Average loss is required for a hypothetical simulation.",
      });
    }
  });

export type MonteCarloInputDTO = z.infer<typeof monteCarloInputSchema>;
