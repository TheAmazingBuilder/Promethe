import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  instrumentFindFirst: vi.fn(),
  instrumentUpsert: vi.fn(),
  instrumentUpdateMany: vi.fn(),
  symbolMappingUpsert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    instrument: {
      findFirst: mocks.instrumentFindFirst,
      upsert: mocks.instrumentUpsert,
      updateMany: mocks.instrumentUpdateMany,
    },
    symbolMapping: { upsert: mocks.symbolMappingUpsert },
  },
}));

import { upsertSymbolMapping } from "@/server/broker-sync";

const sharedInstrument = {
  id: "catalog-xauusd",
  userId: null,
  symbol: "XAUUSD",
  name: "Gold / US Dollar",
  assetClass: "METAL",
  baseCurrency: "XAU",
  quoteCurrency: "USD",
  digits: 2,
  pipSize: "0.1",
  pointSize: "0.01",
  contractSize: "100",
  tickSize: null,
  tickValue: null,
  marketTimezone: null,
  isActive: true,
};

describe("broker symbol mapping pip-size isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.instrumentFindFirst.mockResolvedValue(sharedInstrument);
    mocks.instrumentUpsert.mockResolvedValue({ id: "user-xauusd" });
    mocks.instrumentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.symbolMappingUpsert.mockResolvedValue({});
  });

  it("creates or updates a user-owned copy instead of mutating the shared catalog", async () => {
    await upsertSymbolMapping("user-1", {
      brokerSymbol: "XAUUSD.a",
      instrumentId: "catalog-xauusd",
      pipSize: "0.01",
    });

    expect(mocks.instrumentUpsert).toHaveBeenCalledWith({
      where: {
        userId_symbol: { userId: "user-1", symbol: "XAUUSD" },
      },
      create: expect.objectContaining({
        userId: "user-1",
        symbol: "XAUUSD",
        pipSize: "0.01",
        contractSize: "100",
      }),
      update: { pipSize: "0.01" },
    });
    expect(mocks.instrumentUpdateMany).not.toHaveBeenCalled();
    expect(mocks.symbolMappingUpsert).toHaveBeenCalledWith({
      where: {
        userId_brokerSymbol: { userId: "user-1", brokerSymbol: "XAUUSD.a" },
      },
      update: { instrumentId: "user-xauusd" },
      create: {
        userId: "user-1",
        brokerSymbol: "XAUUSD.a",
        instrumentId: "user-xauusd",
      },
    });
  });

  it("updates a personal instrument only within the current user's scope", async () => {
    mocks.instrumentFindFirst.mockResolvedValue({
      ...sharedInstrument,
      id: "user-owned-xauusd",
      userId: "user-1",
    });

    await upsertSymbolMapping("user-1", {
      brokerSymbol: "XAUUSD",
      instrumentId: "user-owned-xauusd",
      pipSize: "0.01",
    });

    expect(mocks.instrumentUpsert).not.toHaveBeenCalled();
    expect(mocks.instrumentUpdateMany).toHaveBeenCalledWith({
      where: { id: "user-owned-xauusd", userId: "user-1" },
      data: { pipSize: "0.01" },
    });
    expect(mocks.symbolMappingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { instrumentId: "user-owned-xauusd" },
      })
    );
  });

  it("keeps the shared instrument when no personal pip override is supplied", async () => {
    await upsertSymbolMapping("user-1", {
      brokerSymbol: "XAUUSD",
      instrumentId: "catalog-xauusd",
    });

    expect(mocks.instrumentUpsert).not.toHaveBeenCalled();
    expect(mocks.instrumentUpdateMany).not.toHaveBeenCalled();
    expect(mocks.symbolMappingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { instrumentId: "catalog-xauusd" },
      })
    );
  });
});
