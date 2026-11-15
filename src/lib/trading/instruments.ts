/**
 * Global instrument presets — single source of truth for the seed AND for
 * client-side calculators (instant, offline-safe).
 *
 * XAUUSD pip convention: default 1 pip = 0.10 (standard retail convention,
 * e.g. 2345.00 → 2345.10 = 1 pip). Some brokers count 1 pip = 0.01 for gold;
 * pipSize is user-configurable per instrument to match the broker.
 */
import type { AssetClass, InstrumentSpec } from "./types";

export interface InstrumentPreset extends InstrumentSpec {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  /** Decimal values as strings → exact seed + display, no float drift. */
  pipSize: string;
  pointSize: string;
  contractSize: string;
  tickSize?: string | null;
  tickValue?: string | null;
}

const FX5 = {
  digits: 5,
  pipSize: "0.0001",
  pointSize: "0.00001",
  contractSize: "100000",
};
const FX_JPY = {
  digits: 3,
  pipSize: "0.01",
  pointSize: "0.001",
  contractSize: "100000",
};

function fx(
  symbol: string,
  name: string,
  baseCurrency: string,
  quoteCurrency: string,
  jpy = false
): InstrumentPreset {
  return {
    symbol,
    name,
    assetClass: "FOREX",
    baseCurrency,
    quoteCurrency,
    ...(jpy ? FX_JPY : FX5),
  };
}

function index(
  symbol: string,
  name: string,
  digits: number,
  quoteCurrency: string
): InstrumentPreset {
  return {
    symbol,
    name,
    assetClass: "INDEX",
    baseCurrency: null,
    quoteCurrency,
    digits,
    pipSize: "1",
    pointSize: "0.1",
    contractSize: "1",
  };
}

export const PRESET_INSTRUMENTS: InstrumentPreset[] = [
  // ── Forex majors ──
  fx("EURUSD", "Euro / Dollar US", "EUR", "USD"),
  fx("GBPUSD", "Livre sterling / Dollar US", "GBP", "USD"),
  fx("USDJPY", "Dollar US / Yen japonais", "USD", "JPY", true),
  fx("USDCHF", "Dollar US / Franc suisse", "USD", "CHF"),
  fx("USDCAD", "Dollar US / Dollar canadien", "USD", "CAD"),
  fx("AUDUSD", "Dollar australien / Dollar US", "AUD", "USD"),
  fx("NZDUSD", "Dollar néo-zélandais / Dollar US", "NZD", "USD"),
  // ── Forex crosses ──
  fx("EURGBP", "Euro / Livre sterling", "EUR", "GBP"),
  fx("EURCHF", "Euro / Franc suisse", "EUR", "CHF"),
  fx("EURAUD", "Euro / Dollar australien", "EUR", "AUD"),
  fx("EURCAD", "Euro / Dollar canadien", "EUR", "CAD"),
  fx("EURNZD", "Euro / Dollar néo-zélandais", "EUR", "NZD"),
  fx("GBPCHF", "Livre sterling / Franc suisse", "GBP", "CHF"),
  fx("GBPAUD", "Livre sterling / Dollar australien", "GBP", "AUD"),
  fx("GBPCAD", "Livre sterling / Dollar canadien", "GBP", "CAD"),
  fx("GBPNZD", "Livre sterling / Dollar néo-zélandais", "GBP", "NZD"),
  fx("AUDCHF", "Dollar australien / Franc suisse", "AUD", "CHF"),
  fx("AUDCAD", "Dollar australien / Dollar canadien", "AUD", "CAD"),
  fx("AUDNZD", "Dollar australien / Dollar néo-zélandais", "AUD", "NZD"),
  fx("NZDCHF", "Dollar néo-zélandais / Franc suisse", "NZD", "CHF"),
  fx("NZDCAD", "Dollar néo-zélandais / Dollar canadien", "NZD", "CAD"),
  fx("CADCHF", "Dollar canadien / Franc suisse", "CAD", "CHF"),
  // ── Forex JPY crosses ──
  fx("EURJPY", "Euro / Yen japonais", "EUR", "JPY", true),
  fx("GBPJPY", "Livre sterling / Yen japonais", "GBP", "JPY", true),
  fx("AUDJPY", "Dollar australien / Yen japonais", "AUD", "JPY", true),
  fx("NZDJPY", "Dollar néo-zélandais / Yen japonais", "NZD", "JPY", true),
  fx("CADJPY", "Dollar canadien / Yen japonais", "CAD", "JPY", true),
  fx("CHFJPY", "Franc suisse / Yen japonais", "CHF", "JPY", true),
  // ── Métaux ──
  {
    symbol: "XAUUSD",
    name: "Or / Dollar US",
    assetClass: "METAL",
    baseCurrency: "XAU",
    quoteCurrency: "USD",
    digits: 2,
    pipSize: "0.10",
    pointSize: "0.01",
    contractSize: "100",
    tickSize: "0.01",
  },
  {
    symbol: "XAGUSD",
    name: "Argent / Dollar US",
    assetClass: "METAL",
    baseCurrency: "XAG",
    quoteCurrency: "USD",
    digits: 3,
    pipSize: "0.01",
    pointSize: "0.001",
    contractSize: "5000",
    tickSize: "0.001",
  },
  // ── Indices ──
  index("NAS100", "Nasdaq 100 (US100)", 2, "USD"),
  index("US30", "Dow Jones 30", 1, "USD"),
  index("SPX500", "S&P 500", 2, "USD"),
  index("GER40", "DAX 40", 1, "EUR"),
  // ── Crypto ──
  {
    symbol: "BTCUSD",
    name: "Bitcoin / Dollar US",
    assetClass: "CRYPTO",
    baseCurrency: "BTC",
    quoteCurrency: "USD",
    digits: 2,
    pipSize: "1",
    pointSize: "0.01",
    contractSize: "1",
  },
  {
    symbol: "ETHUSD",
    name: "Ethereum / Dollar US",
    assetClass: "CRYPTO",
    baseCurrency: "ETH",
    quoteCurrency: "USD",
    digits: 2,
    pipSize: "0.1",
    pointSize: "0.01",
    contractSize: "1",
  },
  // ── Commodités ──
  {
    symbol: "USOIL",
    name: "Pétrole WTI",
    assetClass: "COMMODITY",
    baseCurrency: null,
    quoteCurrency: "USD",
    digits: 2,
    pipSize: "0.01",
    pointSize: "0.001",
    contractSize: "1000",
    tickSize: "0.01",
  },
];

export function findPreset(symbol: string): InstrumentPreset | undefined {
  return PRESET_INSTRUMENTS.find((i) => i.symbol === symbol.toUpperCase());
}
