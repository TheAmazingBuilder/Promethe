"use client";

/**
 * v3 Phase 5 — Comment thread on a trade (owner view AND read-only mentor
 * view — the API resolves the viewer's context and permissions).
 *
 * Rendering is a restricted markdown subset (bold, italics, lists, links,
 * inline code, quotes) via react-markdown WITHOUT rehype-raw: raw HTML is
 * escaped by design, links get rel="nofollow noopener noreferrer".
 * Mentions (@handle) autocomplete is limited to people who currently have
 * access to the trade — the server validates anyway.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import { Check, Loader2, MessageSquare, Pencil, Reply, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type {
  CommentsPayloadDTO,
  MentionableUserDTO,
  TradeCommentDTO,
} from "@/lib/mentor/dto";
import { format } from "date-fns";

const MARKDOWN_ALLOWED = [
  "p", "strong", "em", "ul", "ol", "li", "a", "code", "blockquote", "br",
];

function fmtTime(iso: string): string {
  return format(new Date(iso), "d MMM yyyy · HH:mm");
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: string; message?: string })
    | null;
  if (!res.ok) {
    throw new Error(body?.message || "Erreur");
  }
  return body as T;
}

export function CommentThread({
  tradeId,
  viewerId,
  ownerView,
}: {
  tradeId: string;
  viewerId: string;
  /** true on the owner's trade detail (owner may delete any comment). */
  ownerView: boolean;
}) {
  const t = useTranslations("comments");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [online, setOnline] = React.useState(true);

  React.useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ["comments", tradeId],
    queryFn: () => apiJson<CommentsPayloadDTO>(`/api/trades/${tradeId}/comments`),
    retry: false,
  });

  const [body, setBody] = React.useState("");
  const [replyTo, setReplyTo] = React.useState<TradeCommentDTO | null>(null);
  const [sending, setSending] = React.useState(false);
  const [mentionQuery, setMentionQuery] = React.useState<string | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const canComment = (data?.canComment ?? false) && online;

  const roots = React.useMemo(
    () => (data?.comments ?? []).filter((c) => !c.parentId),
    [data]
  );
  const repliesOf = React.useCallback(
    (parentId: string) => (data?.comments ?? []).filter((c) => c.parentId === parentId),
    [data]
  );
  const byId = React.useMemo(
    () => new Map((data?.comments ?? []).map((c) => [c.id, c])),
    [data]
  );

  async function submit(): Promise<void> {
    const text = body.trim();
    if (!text || !canComment) return;
    setSending(true);
    try {
      await apiJson(`/api/trades/${tradeId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: text, parentId: replyTo?.id ?? null }),
      });
      setBody("");
      setReplyTo(null);
      await queryClient.invalidateQueries({ queryKey: ["comments", tradeId] });
      await queryClient.invalidateQueries({ queryKey: ["mentor-space"] });
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Réessayez.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  /** Detects a partial @mention at the caret to drive the autocomplete. */
  function onComposerChange(value: string): void {
    setBody(value);
    const el = textareaRef.current;
    if (!el) return;
    const uptoCaret = value.slice(0, el.selectionStart ?? value.length);
    const match = uptoCaret.match(/(?:^|\s)@([a-z0-9_]*)$/i);
    setMentionQuery(match ? match[1].toLowerCase() : null);
  }

  function applyMention(user: MentionableUserDTO): void {
    const el = textareaRef.current;
    if (!el || !user.handle) return;
    const caret = el.selectionStart ?? body.length;
    const uptoCaret = body.slice(0, caret);
    const rest = body.slice(caret);
    const replaced = uptoCaret.replace(/@([a-z0-9_]*)$/i, `@${user.handle} `);
    setBody(replaced + rest);
    setMentionQuery(null);
    requestAnimationFrame(() => el.focus());
  }

  const mentionMatches = React.useMemo(() => {
    if (mentionQuery === null || !data) return [];
    return data.mentionable.filter(
      (u) =>
        u.id !== viewerId &&
        u.handle &&
        (mentionQuery === "" ||
          u.handle.startsWith(mentionQuery) ||
          u.displayName.toLowerCase().includes(mentionQuery))
    );
  }, [mentionQuery, data, viewerId]);

  return (
    <Card id="comments">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          {t("title")}
          {data && data.comments.length > 0 && (
            <Badge variant="secondary" className="tabular-nums">
              {data.comments.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!online && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            {t("offline")}
          </p>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">…</p>
        ) : error ? (
          <p className="text-sm text-rose-600 dark:text-rose-400">{t("loadError")}</p>
        ) : data && data.comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="space-y-3">
            {roots.map((comment) => (
              <li key={comment.id}>
                <CommentItem
                  comment={comment}
                  lastReadAt={data?.lastReadAt ?? null}
                  viewerId={viewerId}
                  ownerView={ownerView}
                  tradeId={tradeId}
                  onReply={
                    canComment && !comment.deletedAt
                      ? () => {
                          setReplyTo(comment);
                          textareaRef.current?.focus();
                        }
                      : undefined
                  }
                />
                {repliesOf(comment.id).length > 0 && (
                  <ul className="mt-2 space-y-2 border-l-2 border-border pl-3 sm:pl-4">
                    {repliesOf(comment.id).map((reply) => (
                      <li key={reply.id}>
                        <CommentItem
                          comment={reply}
                          parentAuthor={byId.get(reply.parentId ?? "")?.author ?? null}
                          lastReadAt={data?.lastReadAt ?? null}
                          viewerId={viewerId}
                          ownerView={ownerView}
                          tradeId={tradeId}
                          onReply={
                            canComment && !reply.deletedAt
                              ? () => {
                                  setReplyTo(comment);
                                  textareaRef.current?.focus();
                                }
                              : undefined
                          }
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}

        {data && !data.canComment && (
          <p className="text-xs text-muted-foreground">{t("canCommentOff")}</p>
        )}

        {canComment && (
          <div className="space-y-2">
            {replyTo && (
              <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-xs">
                <span className="truncate text-muted-foreground">
                  {t("replyingTo", { name: replyTo.author.displayName })}
                </span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setReplyTo(null)}
                  aria-label={t("cancelReply")}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            )}
            <div className="relative">
              <Textarea
                ref={textareaRef}
                value={body}
                onChange={(e) => onComposerChange(e.target.value)}
                placeholder={t("placeholder")}
                rows={3}
                maxLength={4000}
                aria-label={t("placeholder")}
                className="resize-y"
              />
              {mentionQuery !== null && mentionMatches.length > 0 && (
                <ul
                  role="listbox"
                  aria-label={t("mentionHint")}
                  className="absolute z-20 max-h-40 w-full max-w-64 overflow-y-auto rounded-md border bg-popover p-1 text-sm shadow-md"
                >
                  {mentionMatches.slice(0, 6).map((user) => (
                    <li key={user.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
                        onClick={() => applyMention(user)}
                      >
                        <span className="font-mono text-xs text-emerald-700 dark:text-emerald-400">
                          @{user.handle}
                        </span>
                        <span className="truncate text-muted-foreground">
                          {user.displayName}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="hidden text-[11px] text-muted-foreground sm:block">
                {t("mentionHint")}
              </p>
              <Button
                size="sm"
                onClick={() => void submit()}
                disabled={sending || body.trim().length === 0}
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  t("send")
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── single comment ───────────────────────────────────────────────────────────

function CommentItem({
  comment,
  parentAuthor,
  lastReadAt,
  viewerId,
  ownerView,
  tradeId,
  onReply,
}: {
  comment: TradeCommentDTO;
  parentAuthor?: { displayName: string } | null;
  lastReadAt: string | null;
  viewerId: string;
  ownerView: boolean;
  tradeId: string;
  /** Sets the composer into reply mode (one level of threading). */
  onReply?: () => void;
}) {
  const t = useTranslations("comments");
  const tCommon = useTranslations("common");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const [editBody, setEditBody] = React.useState(comment.body);
  const [saving, setSaving] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const isAuthor = comment.author.id === viewerId;
  const unread =
    lastReadAt !== null && comment.createdAt > lastReadAt && !isAuthor;

  async function saveEdit(): Promise<void> {
    const text = editBody.trim();
    if (!text) return;
    setSaving(true);
    try {
      await apiJson(`/api/trades/${tradeId}/comments/${comment.id}`, {
        method: "PATCH",
        body: JSON.stringify({ body: text }),
      });
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["comments", tradeId] });
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Réessayez.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function remove(): Promise<void> {
    try {
      await apiJson(`/api/trades/${tradeId}/comments/${comment.id}`, {
        method: "DELETE",
      });
      await queryClient.invalidateQueries({ queryKey: ["comments", tradeId] });
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Réessayez.",
        variant: "destructive",
      });
    }
  }

  if (comment.deletedAt) {
    return (
      <div className="rounded-lg border border-dashed px-3 py-2 text-xs italic text-muted-foreground">
        {t("deleted")}
      </div>
    );
  }

  return (
    <article
      className={cn(
        "rounded-lg border px-3 py-2.5",
        unread && "border-emerald-500/50 bg-emerald-500/5"
      )}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-medium text-foreground">
          {comment.author.displayName}
        </span>
        {comment.author.handle && (
          <span className="font-mono text-emerald-700 dark:text-emerald-400">
            @{comment.author.handle}
          </span>
        )}
        {comment.author.isOwner && (
          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
            {t("ownerBadge")}
          </Badge>
        )}
        <span className="text-muted-foreground">{fmtTime(comment.createdAt)}</span>
        {comment.editedAt && (
          <span className="italic text-muted-foreground">({t("edited")})</span>
        )}
        {unread && (
          <Badge className="h-4 bg-emerald-600 px-1.5 text-[10px] text-white">
            {t("new")}
          </Badge>
        )}
      </header>

      {parentAuthor && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          ↩ {t("replyingTo", { name: parentAuthor.displayName })}
        </p>
      )}

      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            rows={3}
            maxLength={4000}
            aria-label={t("editPlaceholder")}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void saveEdit()} disabled={saving}>
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {t("saveEdit")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setEditBody(comment.body);
              }}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              {tCommon("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="prose-comment mt-1.5 text-sm leading-relaxed">
          <CommentMarkdown body={comment.body} />
        </div>
      )}

      {(onReply || isAuthor || ownerView) && !editing && (
        <footer className="mt-2 flex items-center gap-1">
          {onReply && (
            <button
              type="button"
              onClick={onReply}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Reply className="h-3 w-3" aria-hidden="true" />
              {t("reply")}
            </button>
          )}
          {isAuthor && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Pencil className="h-3 w-3" aria-hidden="true" />
              {tCommon("edit")}
            </button>
          )}
          {confirmDelete ? (
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => void remove()}
                className="inline-flex items-center gap-1 rounded bg-rose-600/10 px-1.5 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-400"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
                {t("deleteConfirm")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
              {tCommon("delete")}
            </button>
          )}
        </footer>
      )}
    </article>
  );
}

/** Restricted markdown — raw HTML escaped, links hardened. */
export function CommentMarkdown({ body }: { body: string }) {
  return (
    <ReactMarkdown
      allowedElements={MARKDOWN_ALLOWED}
      unwrapDisallowed
      components={{
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="nofollow noopener noreferrer"
            className="text-emerald-700 underline underline-offset-2 dark:text-emerald-400"
          >
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {children}
          </code>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-border pl-2 text-muted-foreground">
            {children}
          </blockquote>
        ),
      }}
    >
      {body}
    </ReactMarkdown>
  );
}
