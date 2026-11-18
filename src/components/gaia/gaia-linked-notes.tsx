"use client";

/**
 * Gaïa — reusable "linked notes" section.
 *
 * Rendered inside other modules (strategy detail, trade review) — not inside
 * Gaïa itself. Lists the notes whose ref blocks point at this entity and
 * offers a "Take notes" button; creation itself is the host's job
 * (onCreateNote), this section only lists and deep-links to the editor.
 * Not injected anywhere yet.
 */
import * as React from "react";
import { ArrowUpRight, NotebookText, StickyNote } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { navigate } from "@/lib/router";
import {
  GAIA_REF_META,
  gaiaRefLabel,
  gaiaRelativeTime,
  useGaiaLinkedNotes,
  type GaiaRefKind,
  type GaiaT,
} from "./gaia-shared";

export function GaiaLinkedNotesSection({
  kind,
  id,
  onCreateNote,
  creating,
  testidPrefix,
  className,
}: {
  kind: GaiaRefKind;
  id: string;
  onCreateNote: () => void;
  creating?: boolean;
  testidPrefix: string;
  className?: string;
}) {
  const t = useTranslations();
  const tr: GaiaT = (key) => t(key);
  const linkedQuery = useGaiaLinkedNotes(kind, id);
  const notes = linkedQuery.data?.notes ?? [];
  const meta = GAIA_REF_META[kind];

  return (
    <section
      data-testid={`${testidPrefix}-gaia-section`}
      className={`rounded-lg border bg-muted/50 p-3 ${className ?? ""}`}
    >
      <div className="flex items-center gap-2">
        <NotebookText className="size-4 shrink-0" style={{ color: meta.hue }} aria-hidden="true" />
        <h3 className="text-xs font-semibold uppercase tracking-wider">
          {t("gaia.linked.title")}
        </h3>
        <span
          data-testid={`${testidPrefix}-gaia-count`}
          className="rounded-full border bg-muted px-1.5 font-mono text-[10px]"
        >
          {notes.length}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid={`${testidPrefix}-take-notes`}
          disabled={creating}
          onClick={onCreateNote}
          className="ml-auto h-7 px-2 text-xs"
        >
          <StickyNote className="size-3.5" aria-hidden="true" />
          {t("gaia.linked.takeNotes")}
        </Button>
      </div>

      {linkedQuery.isLoading ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : notes.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("gaia.linked.emptyPrefix")} {gaiaRefLabel(kind, tr).toLowerCase()}
          {t("gaia.linked.emptySuffix")}
        </p>
      ) : (
        <ul data-testid={`${testidPrefix}-gaia-list`} className="mt-3 space-y-1">
          {notes.slice(0, 5).map((note) => (
            <li key={note.id}>
              <button
                type="button"
                data-testid={`${testidPrefix}-gaia-row`}
                onClick={() => navigate(`/gaia?tab=notes&note=${note.id}`)}
                className="group flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left hover:border-border hover:bg-muted/60"
              >
                <span className="text-sm leading-none" aria-hidden="true">
                  {note.icon ?? "📝"}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {note.title === "" ? t("gaia.shared.untitledNote") : note.title}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {gaiaRelativeTime(note.updatedAt, tr)}
                </span>
                <ArrowUpRight
                  className="size-3.5 shrink-0 text-muted-foreground group-hover:text-emerald-600 dark:group-hover:text-emerald-400"
                  aria-hidden="true"
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      {notes.length > 5 ? (
        <button
          type="button"
          onClick={() => navigate("/gaia?tab=notes")}
          className="mt-2 text-xs text-muted-foreground hover:text-foreground"
        >
          + {notes.length - 5} {t("gaia.linked.moreInNofy")}
        </button>
      ) : null}
    </section>
  );
}
