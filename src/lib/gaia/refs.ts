/**
 * Gaïa : résolution des références par kind.
 *
 * Un bloc `ref` ne stocke que `{ kind, id }`. À chaque lecture de note,
 * `resolveNoteRefs` réécrit `label` / `meta` / `href` avec des données
 * fraîches. Pointeur irrésoluble : label conservé si le client en avait
 * fourni un, sinon "Référence non résolue", `meta` / `href` à null.
 *
 * Mapping Promethe :
 * - TRADE : trade + instrument (symbole) ;
 * - STRATEGY : stratégie du playbook ;
 * - SETUP : le setupType est un champ de Trade, pas une entité. On résout
 *   vers les trades de ce setup (label = nom du setup) ; aucun trade avec
 *   ce setupType : null ;
 * - RULE : règle de trading (TradingRule) ;
 * - LESSON : pas d'équivalent dans Promethe (pas d'Academy) : toujours null ;
 * - EVENT : pas d'équivalent branché (les événements économiques vivent
 *   hors du périmètre Gaïa) : toujours null, comme Euforia ;
 * - SYMBOL : instrument (match sur id ou sur symbole, id normalisé) ;
 * - NOTE : note active de l'utilisateur.
 */
import { db } from "@/lib/db";
import type { GaiaBlock, GaiaRefKind } from "./content";

export type GaiaRefHit = {
  kind: GaiaRefKind;
  id: string;
  label: string;
  meta: string | null;
  href: string | null;
};

export const GAIA_REF_KINDS: readonly GaiaRefKind[] = [
  "TRADE",
  "STRATEGY",
  "SETUP",
  "RULE",
  "LESSON",
  "EVENT",
  "SYMBOL",
  "NOTE",
];

function formatR(r: number): string {
  return `${r >= 0 ? "+" : ""}${r.toFixed(2)}R`;
}

async function resolveTrade(userId: string, id: string): Promise<GaiaRefHit | null> {
  const trade = await db.trade.findFirst({ where: { userId, id } });
  if (!trade) return null;
  const instrument = await db.instrument.findFirst({
    where: { id: trade.instrumentId },
  });
  const symbol = instrument?.symbol ?? "N/A";
  const r = trade.rMultiple === null ? 0 : Number(String(trade.rMultiple));
  return {
    kind: "TRADE",
    id: trade.id,
    label: `Trade ${symbol} ${trade.direction}`,
    meta:
      trade.status === "CLOSED"
        ? `${symbol} ${trade.direction} · ${trade.status} · ${formatR(r)}`
        : `${symbol} ${trade.direction} · ${trade.status}`,
    href: `#/trades?trade=${trade.id}`,
  };
}

async function resolveStrategy(userId: string, id: string): Promise<GaiaRefHit | null> {
  const strategy = await db.strategy.findFirst({ where: { userId, id } });
  if (!strategy) return null;
  return {
    kind: "STRATEGY",
    id: strategy.id,
    label: strategy.name,
    meta: "Stratégie du playbook",
    href: "#/strategies",
  };
}

async function resolveSetup(userId: string, id: string): Promise<GaiaRefHit | null> {
  const trades = await db.trade.findMany({
    where: { userId, setupType: id },
    select: { id: true },
  });
  if (trades.length === 0) return null;
  return {
    kind: "SETUP",
    id,
    label: id,
    meta:
      trades.length === 1
        ? "Setup de trade · 1 trade"
        : `Setup de trade · ${trades.length} trades`,
    href: "#/trades",
  };
}

async function resolveRule(userId: string, id: string): Promise<GaiaRefHit | null> {
  const rule = await db.tradingRule.findFirst({ where: { userId, id } });
  if (!rule) return null;
  return {
    kind: "RULE",
    id: rule.id,
    label: rule.description ?? rule.kind,
    meta: "Règle de trading",
    href: "#/rules",
  };
}

async function resolveSymbol(userId: string, id: string): Promise<GaiaRefHit | null> {
  const instrument = await db.instrument.findFirst({
    where: {
      OR: [{ id }, { symbol: id }],
      AND: [{ OR: [{ userId }, { userId: null }] }],
    },
  });
  if (!instrument) return null;
  return {
    kind: "SYMBOL",
    id: instrument.id,
    label: instrument.symbol,
    meta: instrument.assetClass,
    href: "#/instruments",
  };
}

async function resolveNote(userId: string, id: string): Promise<GaiaRefHit | null> {
  const note = await db.note.findFirst({
    where: { userId, id, deletedAt: null },
  });
  if (!note) return null;
  return {
    kind: "NOTE",
    id: note.id,
    label: note.title === "" ? "Note sans titre" : note.title,
    meta: "Note Gaïa",
    href: `#/gaia?tab=notes&note=${note.id}`,
  };
}

/** Résout une référence. Toute exception est avalée (retourne null). */
export async function resolveRef(
  userId: string,
  kind: GaiaRefKind,
  id: string,
): Promise<GaiaRefHit | null> {
  try {
    switch (kind) {
      case "TRADE":
        return await resolveTrade(userId, id);
      case "STRATEGY":
        return await resolveStrategy(userId, id);
      case "SETUP":
        return await resolveSetup(userId, id);
      case "RULE":
        return await resolveRule(userId, id);
      case "LESSON":
        return null;
      case "EVENT":
        return null;
      case "SYMBOL":
        return await resolveSymbol(userId, id);
      case "NOTE":
        return await resolveNote(userId, id);
    }
  } catch {
    return null;
  }
}

/**
 * Re-résout les blocs `ref` d'une note à la lecture. Les blocs sans `ref`
 * sont retournés tels quels.
 */
export async function resolveNoteRefs(
  userId: string,
  blocks: GaiaBlock[],
): Promise<GaiaBlock[]> {
  const out: GaiaBlock[] = [];
  for (const block of blocks) {
    if (block.type !== "ref" || !block.ref) {
      out.push(block);
      continue;
    }
    const hit = await resolveRef(userId, block.ref.kind, block.ref.id);
    if (hit) {
      out.push({
        ...block,
        ref: { kind: hit.kind, id: hit.id, label: hit.label, meta: hit.meta, href: hit.href },
      });
    } else {
      out.push({
        ...block,
        ref: {
          kind: block.ref.kind,
          id: block.ref.id,
          label: block.ref.label ?? "Référence non résolue",
          meta: null,
          href: null,
        },
      });
    }
  }
  return out;
}

const PICKER_TRADE_LIMIT = 60;
const PICKER_RESULT_LIMIT = 40;

/**
 * Entity picker : scanne les entités par kind, filtre sur `q`
 * (label + meta, insensible à la casse), tronque à 40 résultats.
 * `kind` invalide ou absent : tous les kinds. LESSON et EVENT ne
 * retournent jamais rien.
 */
export async function listRefs(
  userId: string,
  q: string,
  kind?: string,
): Promise<GaiaRefHit[]> {
  const query = q.trim().toLowerCase();
  const wanted: GaiaRefKind[] =
    kind !== undefined &&
    (GAIA_REF_KINDS as readonly string[]).includes(kind)
      ? [kind as GaiaRefKind]
      : [...GAIA_REF_KINDS];

  const hits: GaiaRefHit[] = [];

  if (wanted.includes("TRADE")) {
    const trades = await db.trade.findMany({
      where: { userId },
      orderBy: { entryTime: "desc" },
      take: PICKER_TRADE_LIMIT,
    });
    for (const trade of trades) {
      const hit = await resolveTrade(userId, trade.id);
      if (hit) hits.push(hit);
    }
  }

  if (wanted.includes("STRATEGY")) {
    const strategies = await db.strategy.findMany({ where: { userId } });
    for (const strategy of strategies) {
      const hit = await resolveStrategy(userId, strategy.id);
      if (hit) hits.push(hit);
    }
  }

  if (wanted.includes("SETUP")) {
    const trades = await db.trade.findMany({
      where: { userId, setupType: { not: null } },
      select: { setupType: true },
    });
    const setupTypes = [...new Set(
      trades
        .map((t) => t.setupType)
        .filter((s): s is string => s !== null && s !== ""),
    )];
    for (const setupType of setupTypes) {
      const hit = await resolveSetup(userId, setupType);
      if (hit) hits.push(hit);
    }
  }

  if (wanted.includes("RULE")) {
    const rules = await db.tradingRule.findMany({ where: { userId } });
    for (const rule of rules) {
      const hit = await resolveRule(userId, rule.id);
      if (hit) hits.push(hit);
    }
  }

  if (wanted.includes("SYMBOL")) {
    const instruments = await db.instrument.findMany({
      where: { OR: [{ userId }, { userId: null }] },
    });
    for (const instrument of instruments) {
      const hit = await resolveSymbol(userId, instrument.id);
      if (hit) hits.push(hit);
    }
  }

  if (wanted.includes("NOTE")) {
    const notes = await db.note.findMany({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
    });
    for (const note of notes) {
      const hit = await resolveNote(userId, note.id);
      if (hit) hits.push(hit);
    }
  }

  const filtered =
    query === ""
      ? hits
      : hits.filter((hit) =>
          `${hit.label} ${hit.meta ?? ""}`.toLowerCase().includes(query),
        );
  return filtered.slice(0, PICKER_RESULT_LIMIT);
}
