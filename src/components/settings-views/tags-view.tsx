"use client";

/**
 * Tags view (v1 phase 7) — user tags grouped by kind (SETUP / MISTAKE /
 * CONTEXT / CONFLUENCE / CUSTOM) with full CRUD; global presets are listed read-only with
 * a badge. Data: GET/POST /api/v1/tags · PATCH/DELETE /api/v1/tags/[id].
 */
import * as React from "react";
import { Lock, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateTag,
  useDeleteTag,
  useTags,
  useUpdateTag,
  type TagInputBody,
} from "@/hooks/use-trading";
import { ApiClientError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";
import type { TagDTO } from "@/lib/trading/dto";

const KINDS = ["SETUP", "MISTAKE", "CONTEXT", "CONFLUENCE", "CUSTOM"] as const;
type Kind = (typeof KINDS)[number];

type TagRow = TagDTO & { isPreset?: boolean };

const EMPTY: TagInputBody = { name: "", color: "#64748b", kind: "CUSTOM" };

function TagEditor({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: TagRow | null;
}) {
  const t = useTranslations("tagsView.form");
  const tView = useTranslations("tagsView");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const create = useCreateTag();
  const update = useUpdateTag();
  const [form, setForm] = React.useState<TagInputBody>(EMPTY);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? {
            name: editing.name,
            color: editing.color,
            kind: (KINDS as readonly string[]).includes(editing.kind)
              ? (editing.kind as Kind)
              : "CUSTOM",
          }
        : EMPTY,
    );
  }, [open, editing]);

  const onSave = async () => {
    setSaving(true);
    try {
      const payload: TagInputBody = {
        ...form,
        name: form.name.trim(),
      };
      if (editing) {
        await update.mutateAsync({ id: editing.id, patch: payload });
        toast({ title: t("updated") });
      } else {
        await create.mutateAsync(payload);
        toast({ title: t("created") });
      }
      onOpenChange(false);
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(
          tRoot,
          err?.code,
          error instanceof Error ? error.message : ""
        ),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? t("editTitle") : t("createTitle")}</DialogTitle>
          <DialogDescription className="sr-only">
            {editing ? t("editTitle") : t("createTitle")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="tag-name">{t("name")}</Label>
            <Input
              id="tag-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={t("namePlaceholder")}
              maxLength={40}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tag-kind">{t("kind")}</Label>
              <Select
                value={form.kind}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, kind: v as Kind }))
                }
              >
                <SelectTrigger id="tag-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {tView(`kind.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tag-color">{t("color")}</Label>
              <Input
                id="tag-color"
                type="color"
                value={form.color}
                onChange={(e) =>
                  setForm((f) => ({ ...f, color: e.target.value }))
                }
                className="h-9 w-16 cursor-pointer p-1"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            onClick={() => void onSave()}
            disabled={saving || form.name.trim() === ""}
          >
            {saving ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TagsView() {
  const t = useTranslations("tagsView");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const { data, isLoading } = useTags();
  const del = useDeleteTag();

  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<TagRow | null>(null);

  const list: TagRow[] = data ?? [];
  const userTags = list.filter((x) => !x.isPreset);
  const presets = list.filter((x) => x.isPreset);

  const onEdit = (tag: TagRow) => {
    setEditing(tag);
    setEditorOpen(true);
  };
  const onCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const onDelete = async (tag: TagRow) => {
    try {
      await del.mutateAsync(tag.id);
      toast({ title: t("deletedToast") });
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(
          tRoot,
          err?.code,
          error instanceof Error ? error.message : ""
        ),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Button className="shrink-0" onClick={onCreate}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("add")}
          </Button>
        }
      />

      {isLoading ? (
        <Skeleton className="h-56 w-full rounded-xl" />
      ) : (
        <div className="space-y-6">
          {/* ── User tags by kind ── */}
          {KINDS.map((kind) => {
            const group = userTags.filter((x) => x.kind === kind);
            if (group.length === 0) return null;
            return (
              <section key={kind} className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  {t(`kind.${kind}`)} · {group.length}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {group.map((tag) => (
                    <span
                      key={tag.id}
                      className="flex items-center gap-1.5 rounded-full border py-1 pl-2.5 pr-1 text-sm"
                      style={{ borderColor: `${tag.color}66` }}
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: tag.color }}
                        aria-hidden="true"
                      />
                      {tag.name}
                      <button
                        type="button"
                        aria-label={t("edit")}
                        onClick={() => onEdit(tag)}
                        className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={t("delete")}
                        onClick={() => void onDelete(tag)}
                        className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              </section>
            );
          })}

          {userTags.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <Tags className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">{t("empty")}</p>
                <Button size="sm" onClick={onCreate}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {t("add")}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* ── Presets (read-only) ── */}
          {presets.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {t("presetsTitle")}
                  <Badge variant="secondary">
                    <Lock className="mr-1 h-3 w-3" aria-hidden="true" />
                    {t("readonly")}
                  </Badge>
                </CardTitle>
                <CardDescription>{t("presetsHint")}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {presets.map((tag) => (
                    <span
                      key={tag.id}
                      className="flex items-center gap-1.5 rounded-full border py-1 pl-2.5 pr-2.5 text-sm text-muted-foreground"
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: tag.color }}
                        aria-hidden="true"
                      />
                      {tag.name}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <TagEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
      />
    </div>
  );
}
