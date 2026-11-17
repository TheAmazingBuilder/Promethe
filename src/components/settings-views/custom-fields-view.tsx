"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Archive,
  ArchiveRestore,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateCustomField,
  useCustomFields,
  useDeleteCustomField,
  useUpdateCustomField,
} from "@/hooks/use-productivity";
import { CUSTOM_FIELD_TYPES } from "@/lib/custom-fields/validate";
import { apiErrorMessage } from "@/lib/i18n-errors";
import { ApiClientError } from "@/lib/api-client";
import type { CustomFieldDefinitionDTO } from "@/lib/trading/dto";
import type { CustomFieldDefinitionInput } from "@/lib/validations/productivity";

/**
 * #/reglages/champs-personnalises - custom trade fields (v2.5 Module 4
 * §4.7). Create / edit / archive / delete definitions; archived fields
 * stop appearing in the trade form and table but keep their stored values.
 */
export function CustomFieldsView() {
  const t = useTranslations("customFieldsView");
  const tRoot = useTranslations();
  const tCommon = useTranslations("common");
  const { toast } = useToast();
  const [showArchived, setShowArchived] = React.useState(false);
  const fields = useCustomFields(showArchived);
  const createField = useCreateCustomField();
  const updateField = useUpdateCustomField();
  const deleteField = useDeleteCustomField();
  const [editing, setEditing] = React.useState<CustomFieldDefinitionDTO | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [deleting, setDeleting] = React.useState<CustomFieldDefinitionDTO | null>(null);

  const defs = fields.data ?? [];

  const errorToast = (err: unknown) => {
    const e = err as ApiClientError;
    toast({
      title: apiErrorMessage(
        tRoot,
        e?.code,
        err instanceof Error ? err.message : ""
      ),
      variant: "destructive",
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("new")}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
        <Label htmlFor="cf-archived" className="cursor-pointer font-normal">
          {t("showArchived")}
        </Label>
        <Switch
          id="cf-archived"
          checked={showArchived}
          onCheckedChange={setShowArchived}
        />
      </div>

      {fields.isLoading ? (
        <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>
      ) : defs.length === 0 ? (
        <Card className="gap-0 py-4">
          <CardContent className="px-4">
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("empty")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {defs.map((def) => (
            <Card key={def.id} className="gap-0 py-3">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {def.label}
                    <Badge variant="outline">{t(`types.${def.type}`)}</Badge>
                    {def.required && <Badge variant="secondary">{t("required")}</Badge>}
                    {def.archivedAt && <Badge variant="outline">{t("archived")}</Badge>}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {def.key}
                    {def.options && def.options.length > 0
                      ? ` - ${def.options.join(", ")}`
                      : ""}
                    {def.usableInAnalytics ? ` - ${t("inAnalytics")}` : ""}
                    {def.showInTable ? ` - ${t("inTable")}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={t("edit")}
                    onClick={() => setEditing(def)}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  {def.archivedAt ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={t("restore")}
                      disabled={updateField.isPending}
                      onClick={() =>
                        updateField.mutate(
                          { id: def.id, patch: { archived: false } },
                          {
                            onSuccess: () => toast({ title: t("restoredToast") }),
                            onError: errorToast,
                          }
                        )
                      }
                    >
                      <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={t("archive")}
                      disabled={updateField.isPending}
                      onClick={() =>
                        updateField.mutate(
                          { id: def.id, patch: { archived: true } },
                          {
                            onSuccess: () => toast({ title: t("archivedToast") }),
                            onError: errorToast,
                          }
                        )
                      }
                    >
                      <Archive className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    aria-label={t("delete")}
                    onClick={() => setDeleting(def)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <FieldDialog
        open={creating || editing !== null}
        initial={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSubmit={(input, id) => {
          if (id) {
            updateField.mutate(
              { id, patch: input },
              {
                onSuccess: () => {
                  toast({ title: t("savedToast") });
                  setEditing(null);
                },
                onError: errorToast,
              }
            );
          } else {
            createField.mutate(input, {
              onSuccess: () => {
                toast({ title: t("createdToast") });
                setCreating(false);
              },
              onError: errorToast,
            });
          }
        }}
        pending={createField.isPending || updateField.isPending}
      />

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {tCommon("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={deleteField.isPending}
              onClick={() => {
                if (!deleting) return;
                deleteField.mutate(deleting.id, {
                  onSuccess: () => {
                    toast({ title: t("deletedToast") });
                    setDeleting(null);
                  },
                  onError: errorToast,
                });
              }}
            >
              {tCommon("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FieldDialog({
  open,
  initial,
  onClose,
  onSubmit,
  pending,
}: {
  open: boolean;
  initial: CustomFieldDefinitionDTO | null;
  onClose: () => void;
  onSubmit: (input: CustomFieldDefinitionInput, id: string | null) => void;
  pending: boolean;
}) {
  const t = useTranslations("customFieldsView");
  const tCommon = useTranslations("common");
  const [label, setLabel] = React.useState("");
  const [type, setType] = React.useState<(typeof CUSTOM_FIELD_TYPES)[number]>("TEXT");
  const [optionsText, setOptionsText] = React.useState("");
  const [required, setRequired] = React.useState(false);
  const [showInTable, setShowInTable] = React.useState(false);
  const [showInQuickForm, setShowInQuickForm] = React.useState(false);
  const [usableInAnalytics, setUsableInAnalytics] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setLabel(initial?.label ?? "");
    setType(initial?.type ?? "TEXT");
    setOptionsText(initial?.options?.join(", ") ?? "");
    setRequired(initial?.required ?? false);
    setShowInTable(initial?.showInTable ?? false);
    setShowInQuickForm(initial?.showInQuickForm ?? false);
    setUsableInAnalytics(initial?.usableInAnalytics ?? false);
  }, [open, initial]);

  const needsOptions = type === "SELECT" || type === "MULTI_SELECT";
  const options = optionsText
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const valid =
    label.trim().length > 0 && (!needsOptions || options.length > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? t("editTitle") : t("newTitle")}</DialogTitle>
          <DialogDescription>{t("formDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cf-label">{t("label")}</Label>
            <Input
              id="cf-label"
              value={label}
              maxLength={80}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cf-type">{t("type")}</Label>
            <Select
              value={type}
              onValueChange={(v) =>
                setType(v as (typeof CUSTOM_FIELD_TYPES)[number])
              }
            >
              <SelectTrigger id="cf-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOM_FIELD_TYPES.map((ct) => (
                  <SelectItem key={ct} value={ct}>
                    {t(`types.${ct}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {needsOptions && (
            <div className="space-y-1.5">
              <Label htmlFor="cf-options">{t("options")}</Label>
              <Input
                id="cf-options"
                value={optionsText}
                placeholder={t("optionsPlaceholder")}
                onChange={(e) => setOptionsText(e.target.value)}
              />
            </div>
          )}
          <ToggleRow id="cf-required" label={t("required")} checked={required} onChange={setRequired} />
          <ToggleRow id="cf-table" label={t("showInTable")} checked={showInTable} onChange={setShowInTable} />
          <ToggleRow id="cf-quick" label={t("showInQuickForm")} checked={showInQuickForm} onChange={setShowInQuickForm} />
          <ToggleRow id="cf-analytics" label={t("usableInAnalytics")} checked={usableInAnalytics} onChange={setUsableInAnalytics} />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {tCommon("cancel")}
          </Button>
          <Button
            disabled={!valid || pending}
            onClick={() =>
              onSubmit(
                {
                  label: label.trim(),
                  type,
                  options,
                  required,
                  showInTable,
                  showInQuickForm,
                  usableInAnalytics,
                },
                initial?.id ?? null
              )
            }
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {tCommon("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
      <Label htmlFor={id} className="cursor-pointer font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
