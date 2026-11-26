/**
 * Gaïa : contenu des notes (blocs).
 *
 * Principe : BLOCK JSON, never HTML. L'éditeur parle JSON de blocs ; rien
 * n'accepte de HTML brut, donc aucune sanitisation HTML côté serveur : la
 * charge est validée par schéma (vocabulaire fermé + plafonds de taille).
 * Contrairement à Euforia, les fonctions pures définies ici sont APPELÉES
 * par le code serveur (isSafeImageSrc à l'écriture, parseStoredBlocks à la
 * relecture, normalizeBlocks avant stockage).
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getCandlestickPattern, isCandlestickPatternId } from "./patterns/catalog";

export const GAIA_BLOCK_TYPES = [
  "paragraph",
  "h1",
  "h2",
  "h3",
  "bullet",
  "numbered",
  "todo",
  "quote",
  "callout",
  "code",
  "table",
  "image",
  "divider",
  "ref",
  "pattern",
] as const;

export type GaiaBlockType = (typeof GAIA_BLOCK_TYPES)[number];

export const GAIA_CALLOUT_TONES = ["info", "tip", "warn", "risk"] as const;
export type GaiaCalloutTone = (typeof GAIA_CALLOUT_TONES)[number];

export const GAIA_REF_KINDS = [
  "TRADE",
  "STRATEGY",
  "SETUP",
  "RULE",
  "LESSON",
  "EVENT",
  "SYMBOL",
  "NOTE",
] as const;
export type GaiaRefKind = (typeof GAIA_REF_KINDS)[number];

export const gaiaBlockTypeSchema = z.enum(GAIA_BLOCK_TYPES);
export const gaiaCalloutToneSchema = z.enum(GAIA_CALLOUT_TONES);
export const gaiaRefKindSchema = z.enum(GAIA_REF_KINDS);

/** Limites d'entrée (spec backend §2.2). */
export const GAIA_MAX_BLOCKS = 500;
export const GAIA_MAX_BLOCK_TEXT = 20_000;
export const GAIA_MAX_TABLE_ROWS = 200;
export const GAIA_MAX_TABLE_COLS = 8;
export const GAIA_MAX_IMAGE_SRC = 2_000_000;

export const gaiaBlockRefInputSchema = z.object({
  kind: gaiaRefKindSchema,
  id: z.string().min(1).max(128),
  label: z.string().max(200).optional(),
  meta: z.string().max(200).nullable().optional(),
  href: z.string().max(300).nullable().optional(),
});

export const gaiaBlockInputSchema = z.object({
  id: z.string().min(1).max(64),
  type: gaiaBlockTypeSchema,
  text: z.string().max(GAIA_MAX_BLOCK_TEXT).default(""),
  checked: z.boolean().optional(),
  tone: gaiaCalloutToneSchema.optional(),
  src: z.string().max(GAIA_MAX_IMAGE_SRC).optional(),
  alt: z.string().max(300).optional(),
  caption: z.string().max(300).optional(),
  rows: z
    .array(z.array(z.string().max(2_000)).max(GAIA_MAX_TABLE_COLS))
    .max(GAIA_MAX_TABLE_ROWS)
    .optional(),
  ref: gaiaBlockRefInputSchema.optional(),
  patternId: z.string().refine(isCandlestickPatternId, "Unknown candlestick pattern").optional(),
}).superRefine((block, context) => { if (block.type === "pattern" && !block.patternId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["patternId"], message: "Pattern id is required" }); });

export const gaiaBlocksInputSchema = z
  .array(gaiaBlockInputSchema)
  .max(GAIA_MAX_BLOCKS);

export type GaiaBlockInput = z.infer<typeof gaiaBlockInputSchema>;

export type GaiaBlockRef = {
  kind: GaiaRefKind;
  id: string;
  label?: string;
  meta?: string | null;
  href?: string | null;
};

export type GaiaBlock = {
  id: string;
  type: GaiaBlockType;
  text: string;
  checked?: boolean;
  tone?: GaiaCalloutTone;
  src?: string;
  alt?: string;
  caption?: string;
  rows?: string[][];
  ref?: GaiaBlockRef;
  patternId?: string;
};

/** Nouvel id de bloc : `nb-` + 24 caractères hex. */
export function newBlockId(): string {
  return `nb-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/**
 * Normalisation à l'écriture : les champs d'affichage du `ref` sont supprimés
 * avant stockage, seuls `kind` + `id` persistent. `label` / `meta` / `href`
 * sont re-résolus côté serveur à chaque lecture.
 */
export function normalizeBlocks(input: GaiaBlockInput[]): GaiaBlock[] {
  return input.map((block) => {
    const out: GaiaBlock = {
      id: block.id,
      type: block.type,
      text: block.text ?? "",
    };
    if (block.checked !== undefined) out.checked = block.checked;
    if (block.tone !== undefined) out.tone = block.tone;
    // A pattern block carries no image: its illustration is derived from
    // the pattern id in-app. Drop any src/alt/caption so no arbitrary URL
    // can ride along with a pattern.
    if (block.type !== "pattern") {
      if (block.src !== undefined) out.src = block.src;
      if (block.alt !== undefined) out.alt = block.alt;
      if (block.caption !== undefined) out.caption = block.caption;
    }
    if (block.rows !== undefined) out.rows = block.rows;
    if (block.type === "pattern" && block.patternId) out.patternId = block.patternId;
    if (block.ref !== undefined && block.ref !== null) {
      out.ref = { kind: block.ref.kind, id: block.ref.id };
    }
    return out;
  });
}

/**
 * Images : protocole restreint. Seules les URL http(s) et les data URL
 * d'images en base64 sont acceptées. Appelée à l'écriture (create / patch).
 */
const SAFE_IMAGE_SRC =
  /^(https?:\/\/|data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,)/i;

export function isSafeImageSrc(src: string | undefined): boolean {
  if (src === undefined) return true;
  return SAFE_IMAGE_SRC.test(src);
}

/**
 * Relecture défensive des blocs stockés : les blocs inconnus ou corrompus
 * sont ignorés (dropped), jamais servis.
 */
export function parseStoredBlocks(value: unknown): GaiaBlock[] {
  if (!Array.isArray(value)) return [];
  const out: GaiaBlock[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.id !== "string" || raw.id === "") continue;
    if (
      typeof raw.type !== "string" ||
      !(GAIA_BLOCK_TYPES as readonly string[]).includes(raw.type)
    ) {
      continue;
    }
    const block: GaiaBlock = {
      id: raw.id,
      type: raw.type as GaiaBlockType,
      text: typeof raw.text === "string" ? raw.text : "",
    };
    if (typeof raw.checked === "boolean") block.checked = raw.checked;
    if (
      typeof raw.tone === "string" &&
      (GAIA_CALLOUT_TONES as readonly string[]).includes(raw.tone)
    ) {
      block.tone = raw.tone as GaiaCalloutTone;
    }
    if (raw.type === "pattern") { if (typeof raw.patternId !== "string" || !isCandlestickPatternId(raw.patternId)) continue; block.patternId = raw.patternId; }
    // A pattern block carries no image: drop any stored src/alt/caption
    // so a persisted pattern can never smuggle in an arbitrary URL.
    if (raw.type !== "pattern") {
      if (typeof raw.src === "string") block.src = raw.src;
      if (typeof raw.alt === "string") block.alt = raw.alt;
      if (typeof raw.caption === "string") block.caption = raw.caption;
    }
    if (
      Array.isArray(raw.rows) &&
      raw.rows.every(
        (row) =>
          Array.isArray(row) &&
          row.every((cell) => typeof cell === "string"),
      )
    ) {
      block.rows = raw.rows as string[][];
    }
    if (typeof raw.ref === "object" && raw.ref !== null) {
      const ref = raw.ref as Record<string, unknown>;
      if (
        typeof ref.kind === "string" &&
        (GAIA_REF_KINDS as readonly string[]).includes(ref.kind) &&
        typeof ref.id === "string" &&
        ref.id !== ""
      ) {
        const resolved: GaiaBlockRef = {
          kind: ref.kind as GaiaRefKind,
          id: ref.id,
        };
        if (typeof ref.label === "string") resolved.label = ref.label;
        if (typeof ref.meta === "string" || ref.meta === null) {
          resolved.meta = ref.meta;
        }
        if (typeof ref.href === "string" || ref.href === null) {
          resolved.href = ref.href;
        }
        block.ref = resolved;
      }
    }
    out.push(block);
  }
  return out;
}

/** Parse une colonne JSON String du repo (défaut [] si vide ou corrompue). */
export function parseJsonBlocks(stored: string | null | undefined): GaiaBlock[] {
  if (!stored) return [];
  try {
    return parseStoredBlocks(JSON.parse(stored));
  } catch {
    return [];
  }
}

export function parseJsonStringArray(
  stored: string | null | undefined,
): string[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

const TEXT_BEARING = new Set([
  "paragraph",
  "h1",
  "h2",
  "h3",
  "bullet",
  "numbered",
  "todo",
  "quote",
  "callout",
  "code",
]);

export function textOfBlocks(blocks: GaiaBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (TEXT_BEARING.has(block.type) && block.text.trim() !== "") {
      parts.push(block.text.trim());
    }
    if (block.type === "table" && block.rows) {
      for (const row of block.rows) parts.push(row.join(" | "));
    }
    if (block.type === "image" && block.caption) parts.push(block.caption);
  }
  return parts.join("\n");
}

/**
 * Text searchable by users, including metadata for non-text blocks.
 * Pattern descriptions and aliases are indexed without inflating the note's
 * visible excerpt or word count.
 */
export function searchTextOfBlocks(blocks: GaiaBlock[]): string {
  const parts = [textOfBlocks(blocks)];
  for (const block of blocks) {
    if (block.type !== "pattern" || !block.patternId) continue;
    const pattern = getCandlestickPattern(block.patternId);
    if (!pattern) continue;
    parts.push(
      pattern.name,
      ...pattern.aliases,
      pattern.description,
      pattern.marketContext,
      pattern.interpretation,
      pattern.confirmation,
      pattern.caveats,
    );
  }
  return parts.filter(Boolean).join("\n");
}

export function wordCountOf(text: string): number {
  return text.split(/\s+/).filter((word) => word !== "").length;
}

export function countWords(blocks: GaiaBlock[]): number {
  return wordCountOf(textOfBlocks(blocks));
}

export function countOpenTodos(blocks: GaiaBlock[]): number {
  return blocks.filter((block) => block.type === "todo" && !block.checked)
    .length;
}

/** Extrait d'environ 180 caractères tiré des premiers blocs porteurs de texte. */
export function excerptOf(blocks: GaiaBlock[]): string {
  const text = textOfBlocks(blocks).replace(/\n+/g, " · ");
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

/**
 * Snippet de recherche centré sur le premier hit plein texte (60 caractères
 * avant, 80 après la fin du hit), ou l'extrait quand seuls le titre ou les
 * tags ont matché.
 */
export function searchSnippet(blocks: GaiaBlock[], query: string): string {
  const fullText = searchTextOfBlocks(blocks);
  const index = fullText.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return excerptOf(blocks);
  const start = Math.max(0, index - 60);
  const end = Math.min(fullText.length, index + query.length + 80);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < fullText.length ? "…" : "";
  return `${prefix}${fullText.slice(start, end).replace(/\n+/g, " ")}${suffix}`;
}
