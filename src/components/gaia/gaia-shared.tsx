"use client";

/**
 * Gaïa — shared types, visuals and data layer.
 *
 * Replica of Euforia's Nofy shared module, renamed for Promethe: every
 * user-facing string goes through gaia.* i18n keys, hues are emerald/teal
 * (never Euforia's cobalt), and the API base is /api/v1/gaia.
 */
import * as React from "react";
import {
  CandlestickChart,
  FlaskConical,
  Globe2,
  GraduationCap,
  NotebookText,
  ScrollText,
  Swords,
  type LucideIcon,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { parseHash, routeToPath } from "@/lib/routes";

// ── Block model (mirrors the backend contract) ─────────────────────────────

export type GaiaBlockType =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "numbered"
  | "todo"
  | "quote"
  | "callout"
  | "divider"
  | "code"
  | "table"
  | "image"
  | "ref"
  | "pattern";

export type GaiaCalloutTone = "info" | "tip" | "warn" | "risk";

export type GaiaRefKind =
  | "TRADE"
  | "STRATEGY"
  | "SETUP"
  | "RULE"
  | "LESSON"
  | "EVENT"
  | "SYMBOL"
  | "NOTE";

export interface GaiaBlockRef {
  kind: GaiaRefKind;
  id: string;
  label?: string;
  meta?: string | null;
  href?: string | null;
}

export interface GaiaBlock {
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
}

export interface GaiaLessonRef {
  courseId: string;
  courseTitle: string;
  lessonId: string;
  lessonTitle: string;
}

export interface GaiaNote {
  id: string;
  userId: string;
  title: string;
  icon: string | null;
  folderId: string | null;
  tagIds: string[];
  favorite: boolean;
  templateId: string | null;
  lessonRef: GaiaLessonRef | null;
  blocks: GaiaBlock[];
  createdAt: string;
  updatedAt: string;
  lastViewedAt: string | null;
  deletedAt: string | null;
}

export interface GaiaNoteRow {
  id: string;
  title: string;
  icon: string | null;
  folderId: string | null;
  folderName: string | null;
  tagIds: string[];
  tagNames: string[];
  favorite: boolean;
  templateId: string | null;
  lessonRef: GaiaLessonRef | null;
  excerpt: string;
  wordCount: number;
  blockCount: number;
  refCount: number;
  todoOpen: number;
  createdAt: string;
  updatedAt: string;
  lastViewedAt: string | null;
  deletedAt: string | null;
}

export interface GaiaFolder {
  id: string;
  name: string;
  createdAt: string;
  noteCount: number;
}

export interface GaiaTag {
  id: string;
  name: string;
  noteCount: number;
}

export interface GaiaTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  blocks: GaiaBlock[];
  builtIn: boolean;
  createdAt: string;
}

export interface GaiaActivityWeek {
  weekStart: string;
  created: number;
  edited: number;
}

export interface GaiaOverview {
  totals: {
    notes: number;
    createdThisWeek: number;
    favorites: number;
    folders: number;
    tags: number;
    trashed: number;
  };
  recentEdited: GaiaNoteRow[];
  recentViewed: GaiaNoteRow[];
  favorites: GaiaNoteRow[];
  folders: GaiaFolder[];
  topTags: GaiaTag[];
  activity: GaiaActivityWeek[];
  templates: GaiaTemplate[];
}

export interface GaiaVersion {
  id: string;
  title: string;
  savedAt: string;
  wordCount: number;
}

export interface GaiaRefHit {
  kind: GaiaRefKind;
  id: string;
  label: string;
  meta: string | null;
  href: string | null;
}

export type GaiaNotesView = "all" | "favorites" | "trash" | "folder" | "tag";

export type GaiaTab = "overview" | "notes" | "folders" | "favorites" | "templates" | "trash";

export interface GaiaNotesParams {
  view: GaiaNotesView;
  folderId: string;
  tagId: string;
  q: string;
  sort: string;
  /** Rows per page (server default 50, max 100). */
  pageSize?: number;
}

export const GAIA_DEFAULT_PARAMS: GaiaNotesParams = {
  view: "all",
  folderId: "",
  tagId: "",
  q: "",
  sort: "updated",
  pageSize: 50,
};

export type GaiaT = (key: string) => string;

export function newBlockId(): string {
  return `nb-${Math.random().toString(36).slice(2, 10)}${Date.now()
    .toString(36)
    .slice(-4)}`;
}

export function gaiaErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return "Error";
}

// ── Ref kinds: icon + hue (emerald/teal Promethe palette, never cobalt) ────

export const GAIA_REF_META: Record<
  GaiaRefKind,
  { labelKey: string; icon: LucideIcon; hue: string }
> = {
  TRADE: { labelKey: "gaia.refKinds.trade", icon: CandlestickChart, hue: "#10b981" },
  STRATEGY: { labelKey: "gaia.refKinds.strategy", icon: Swords, hue: "#14b8a6" },
  SETUP: { labelKey: "gaia.refKinds.setup", icon: FlaskConical, hue: "#2dd4bf" },
  RULE: { labelKey: "gaia.refKinds.rule", icon: ScrollText, hue: "#fb7185" },
  LESSON: { labelKey: "gaia.refKinds.lesson", icon: GraduationCap, hue: "#fbbf24" },
  EVENT: { labelKey: "gaia.refKinds.event", icon: Globe2, hue: "#f59e0b" },
  SYMBOL: { labelKey: "gaia.refKinds.symbol", icon: NotebookText, hue: "#34d399" },
  NOTE: { labelKey: "gaia.refKinds.note", icon: NotebookText, hue: "#5eead4" },
};

export const GAIA_REF_KINDS: GaiaRefKind[] = [
  "TRADE",
  "STRATEGY",
  "SETUP",
  "RULE",
  "LESSON",
  "EVENT",
  "SYMBOL",
  "NOTE",
];

export function gaiaRefLabel(kind: GaiaRefKind, t: GaiaT): string {
  return t(GAIA_REF_META[kind].labelKey);
}

/** Only internal hrefs are ever linked (never raw HTML, XSS-safe by design).
 *  Legacy "#/..." hrefs stored in old notes are upgraded to clean URLs. */
export function safeGaiaHref(href: string | null | undefined): string | null {
  if (!href) return null;
  if (href.startsWith("#/")) return routeToPath(parseHash(href));
  if (href.startsWith("/")) return href;
  return null;
}

// ── Relative time ────────────────────────────────────────────────────────────

export function gaiaRelativeTime(
  iso: string | null | undefined,
  t: GaiaT,
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 45) return t("gaia.time.justNow");
  const prefix = t("gaia.time.agoPrefix");
  const suffix = t("gaia.time.agoSuffix");
  const compose = (n: number, one: string, many: string) =>
    [prefix, String(n), n === 1 ? one : many, suffix]
      .filter((part) => part !== "")
      .join(" ");
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60)
    return compose(diffMin, t("gaia.time.minuteOne"), t("gaia.time.minuteMany"));
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24)
    return compose(diffHours, t("gaia.time.hourOne"), t("gaia.time.hourMany"));
  if (diffHours < 48) return t("gaia.time.yesterday");
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return compose(diffDays, t("gaia.time.days"), t("gaia.time.days"));
  return date.toLocaleDateString("en-CA");
}

// ── Small shared visuals ─────────────────────────────────────────────────────

export function TagChip({
  name,
  active,
  onClick,
  title,
}: {
  name: string;
  active?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const cls = active
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : "border-border bg-muted text-muted-foreground";
  const inner = (
    <span
      className={`inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0.5 text-[11px] ${cls}`}
      title={title}
    >
      #{name}
    </span>
  );
  if (!onClick) return inner;
  return (
    <button type="button" onClick={onClick} className="shrink-0 transition-colors">
      {inner}
    </button>
  );
}

export function FolderChip({ name }: { name: string | null }) {
  if (!name) return null;
  return (
    <span className="inline-flex shrink-0 items-center rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
      {name}
    </span>
  );
}

/** Inline **bold**, *italic* and `code` — parsed into React nodes, never HTML. */
export function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          return (
            <strong key={i} className="font-semibold text-foreground">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
          return (
            <code
              key={i}
              className="rounded-sm border bg-muted px-1 py-0.5 font-mono text-[0.85em]"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </>
  );
}

export function GaiaEmptyState({
  icon,
  title,
  body,
  action,
  testid,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
  testid?: string;
}) {
  return (
    <div
      data-testid={testid}
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center"
    >
      <div className="text-muted-foreground">{icon}</div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

// ── API layer (/api/v1/gaia/*) ──────────────────────────────────────────────────

const GAIA_BASE = "/api/v1/gaia";

function gaiaNotesQuery(params: GaiaNotesParams): string {
  const q = new URLSearchParams();
  q.set("view", params.view);
  if (params.view === "folder" && params.folderId) q.set("folderId", params.folderId);
  if (params.view === "tag" && params.tagId) q.set("tagId", params.tagId);
  if (params.q) q.set("q", params.q);
  if (params.sort && params.sort !== "updated") q.set("sort", params.sort);
  if (params.pageSize && params.pageSize !== 50) {
    q.set("pageSize", String(params.pageSize));
  }
  return q.toString();
}

export function useGaiaOverview() {
  return useQuery({
    queryKey: ["gaia", "overview"],
    queryFn: () => apiFetch<GaiaOverview>(`${GAIA_BASE}/overview`),
  });
}

export function useGaiaNotes(params: GaiaNotesParams) {
  return useQuery({
    queryKey: ["gaia", "notes", params],
    queryFn: () =>
      apiFetch<{ notes: GaiaNoteRow[]; total: number }>(
        `${GAIA_BASE}/notes?${gaiaNotesQuery(params)}`,
      ),
  });
}

export function useGaiaNote(noteId: string | null) {
  return useQuery({
    queryKey: ["gaia", "note", noteId],
    queryFn: () =>
      apiFetch<{ note: GaiaNote; folderName: string | null; tagNames: string[] }>(
        `${GAIA_BASE}/notes/${noteId}`,
      ),
    enabled: noteId !== null && noteId !== "",
  });
}

export function useGaiaFolders() {
  return useQuery({
    queryKey: ["gaia", "folders"],
    queryFn: () => apiFetch<{ folders: GaiaFolder[] }>(`${GAIA_BASE}/folders`),
  });
}

export function useGaiaTags() {
  return useQuery({
    queryKey: ["gaia", "tags"],
    queryFn: () => apiFetch<{ tags: GaiaTag[] }>(`${GAIA_BASE}/tags`),
  });
}

export function useGaiaTemplates() {
  return useQuery({
    queryKey: ["gaia", "templates"],
    queryFn: () => apiFetch<{ templates: GaiaTemplate[] }>(`${GAIA_BASE}/templates`),
  });
}

export interface GaiaVersionDetail {
  id: string;
  title: string;
  savedAt: string;
  blocks: GaiaBlock[];
}

export function useGaiaVersions(noteId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["gaia", "versions", noteId],
    queryFn: () =>
      apiFetch<{ versions: GaiaVersion[] }>(`${GAIA_BASE}/notes/${noteId}/versions`),
    enabled: enabled && noteId !== null && noteId !== "",
  });
}

// Lot 11 (roadmap §15): fetch one version in full (blocks) so the
// VersionsDialog can preview it and diff it against the current note
// before the user restores it.
export function useGaiaVersion(
  noteId: string | null,
  versionId: string | null,
) {
  return useQuery({
    queryKey: ["gaia", "version", noteId, versionId],
    queryFn: () =>
      apiFetch<{ version: GaiaVersionDetail }>(
        `${GAIA_BASE}/notes/${noteId}/versions/${versionId}`,
      ),
    enabled: noteId != null && noteId !== "" && versionId != null && versionId !== "",
  });
}

export function useGaiaRefs(query: string, kind: GaiaRefKind | "", enabled = true) {
  return useQuery({
    queryKey: ["gaia", "refs", query, kind],
    enabled,
    queryFn: () => {
      const q = new URLSearchParams();
      if (query) q.set("q", query);
      if (kind) q.set("kind", kind);
      const suffix = q.toString();
      return apiFetch<{ refs: GaiaRefHit[] }>(
        `${GAIA_BASE}/refs${suffix ? `?${suffix}` : ""}`,
      );
    },
  });
}

export function useGaiaLinkedNotes(kind: GaiaRefKind, id: string) {
  return useQuery({
    queryKey: ["gaia", "notes", "linked", kind, id],
    queryFn: () =>
      apiFetch<{ notes: GaiaNoteRow[]; total: number }>(
        `${GAIA_BASE}/notes?refKind=${kind}&refId=${encodeURIComponent(id)}`,
      ),
    enabled: id !== "",
  });
}

function useGaiaInvalidate() {
  const qc = useQueryClient();
  return React.useCallback(
    () => qc.invalidateQueries({ queryKey: ["gaia"] }),
    [qc],
  );
}

export interface GaiaNoteCreateInput {
  title?: string;
  folderId?: string | null;
  templateId?: string;
  lessonRef?: GaiaLessonRef;
  blocks?: GaiaBlock[];
}

export interface GaiaNoteUpdateInput {
  title?: string;
  icon?: string | null;
  folderId?: string | null;
  tagIds?: string[];
  favorite?: boolean;
  blocks?: GaiaBlock[];
}

export function useCreateGaiaNote() {
  const invalidate = useGaiaInvalidate();
  return useMutation({
    mutationFn: (input: GaiaNoteCreateInput) =>
      apiFetch<{ note: GaiaNote }>(`${GAIA_BASE}/notes`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateGaiaNote() {
  const invalidate = useGaiaInvalidate();
  return useMutation({
    mutationFn: ({ noteId, patch }: { noteId: string; patch: GaiaNoteUpdateInput }) =>
      apiFetch<{ note: GaiaNote; folderName: string | null; tagNames: string[] }>(
        `${GAIA_BASE}/notes/${noteId}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      ),
    onSuccess: () => invalidate(),
  });
}

export function useTrashGaiaNote() {
  const invalidate = useGaiaInvalidate();
  return useMutation({
    mutationFn: (noteId: string) =>
      apiFetch<{ ok: boolean }>(`${GAIA_BASE}/notes/${noteId}`, { method: "DELETE" }),
    onSuccess: () => invalidate(),
  });
}

export function useDuplicateGaiaNote() {
  const invalidate = useGaiaInvalidate();
  return useMutation({
    mutationFn: ({ noteId, title }: { noteId: string; title?: string }) =>
      apiFetch<{ note: GaiaNote }>(`${GAIA_BASE}/notes/${noteId}/duplicate`, {
        method: "POST",
        body: JSON.stringify(title ? { title } : {}),
      }),
    onSuccess: () => invalidate(),
  });
}

export function useRestoreGaiaNote() {
  const invalidate = useGaiaInvalidate();
  return useMutation({
    mutationFn: (noteId: string) =>
      apiFetch<{ ok: boolean }>(`${GAIA_BASE}/notes/${noteId}/restore`, {
        method: "POST",
      }),
    onSuccess: () => invalidate(),
  });
}

export function usePurgeGaiaNote() {
  const invalidate = useGaiaInvalidate();
  return useMutation({
    mutationFn: (noteId: string) =>
      apiFetch<{ ok: boolean }>(`${GAIA_BASE}/notes/${noteId}/permanent`, {
        method: "DELETE",
      }),
    onSuccess: () => invalidate(),
  });
}

export function useCreateGaiaFolder() {
  const invalidate = useGaiaInvalidate();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<GaiaFolder>(`${GAIA_BASE}/folders`, {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateGaiaFolder() {
  const invalidate = useGaiaInvalidate();
  return useMutation({
    mutationFn: ({ folderId, name }: { folderId: string; name: string }) =>
      apiFetch<GaiaFolder>(`${GAIA_BASE}/folders/${folderId}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteGaiaFolder() {
  const invalidate = useGaiaInvalidate();
  return useMutation({
    mutationFn: (folderId: string) =>
      apiFetch<{ ok: boolean }>(`${GAIA_BASE}/folders/${folderId}`, {
        method: "DELETE",
      }),
    onSuccess: () => invalidate(),
  });
}

export function useCreateGaiaTag() {
  const invalidate = useGaiaInvalidate();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<GaiaTag>(`${GAIA_BASE}/tags`, {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => invalidate(),
  });
}

export function useCreateGaiaTemplate() {
  const invalidate = useGaiaInvalidate();
  return useMutation({
    mutationFn: (input: {
      name: string;
      description: string;
      icon: string;
      fromNoteId?: string;
      blocks?: GaiaBlock[];
    }) =>
      apiFetch<GaiaTemplate>(`${GAIA_BASE}/templates`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidate(),
  });
}

export function useInstantiateGaiaTemplate() {
  const invalidate = useGaiaInvalidate();
  return useMutation({
    mutationFn: (input: { templateId: string; title?: string; folderId?: string | null }) =>
      apiFetch<{ note: GaiaNote }>(`${GAIA_BASE}/templates/instantiate`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidate(),
  });
}

export function useRestoreGaiaVersion() {
  const invalidate = useGaiaInvalidate();
  return useMutation({
    mutationFn: ({ noteId, versionId }: { noteId: string; versionId: string }) =>
      apiFetch<{ note: GaiaNote }>(
        `${GAIA_BASE}/notes/${noteId}/versions/${versionId}/restore`,
        { method: "POST" },
      ),
    onSuccess: () => invalidate(),
  });
}
