import { z } from "zod";

export const monteCarloInputSchema = z.object({
  accountId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(80).default("Monte Carlo simulation"),
  riskPercent: z.number().min(0.1).max(10).default(1),
  iterations: z.number().int().min(100).max(10000).default(2000),
  tradesPerPath: z.number().int().min(10).max(500).default(100),
  targetPercent: z.number().min(0.1).max(500).default(10),
  ruinThresholdPercent: z.number().min(1).max(99).default(30),
  seed: z.number().int().min(0).max(4294967295).default(42),
});

export type MonteCarloInputDTO = z.infer<typeof monteCarloInputSchema>;
