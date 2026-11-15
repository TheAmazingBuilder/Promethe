"use client";

/**
 * DashboardsSettingsView (v2.5 Module 1, spec §4.9) — #/reglages/dashboards.
 *
 * Manage the dashboards (default star, delete), browse the built-in
 * templates + the user's saved blueprints (add as new / replace current /
 * apply-as-new via the import endpoint), export/import dashboards as
 * portable JSON, and build custom metrics (delegated to the builder).
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Download,
  LayoutTemplate,
  Pencil,
  Plus,
  Save,
  Star,
  Trash2,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { useToast } from "@/hooks/use-toast";
import {
  fetchDashboardExport,
  useApplyTemplate,
  useCreateDashboard,
  useDashboards,
  useDeleteDashboard,
  useDeleteUserTemplate,
  useImportDashboards,
  usePatchDashboard,
  useSaveAsTemplate,
  useUserTemplates,
} from "@/hooks/use-dashboards";
import { getWidgetDefinition } from "@/lib/dashboard/registry";
import { BUILT_IN_TEMPLATES } from "@/lib/dashboard/templates";
import { DASHBOARD_IMPORT_MAX_BYTES } from "@/lib/validations/dashboard";
import { ApiClientError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";
import { DashboardIcon } from "@/components/dashboard/icons";
import {
  CustomMetricsSection,
} from "@/components/settings-views/custom-metric-builder";
import { cn } from "@/lib/utils";

function useApiErrorToast() {
  const tRoot = useTranslations();
  const { toast } = useToast();
  return React.useCallback(
    (error: unknown) => {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(
          tRoot,
          err?.code,
          error instanceof Error ? error.message : ""
        ),
        variant: "destructive",
      });
    },
    [tRoot, toast]
  );
}

// ── 1. Your dashboards ───────────────────────────────────────────────────────

function YourDashboardsCard() {
  const t = useTranslations("dashboardsSettings");
  const tDash = useTranslations("dashboards");
  const dashboards = useDashboards();
  const patch = usePatchDashboard();
  const del = useDeleteDashboard();
  const onError = useApiErrorToast();
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);

  const list = dashboards.data?.dashboards ?? [];
  const lastOne = list.length <= 1;

  const onToggleDefault = async (id: string, isDefault: boolean) => {
    try {
      await patch.mutateAsync({ id, patch: { isDefault: !isDefault } });
    } catch (error) {
      onError(error);
    }
  };

  const onDelete = async (id: string) => {
    try {
      await del.mutateAsync(id);
    } catch (error) {
      onError(error);
    } finally {
      setConfirmDelete(null);
    }
  };

  const deleting = list.find((d) => d.id === confirmDelete);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("dashboardsTitle")}</CardTitle>
        <CardDescription>{t("dashboardsDesc")}</CardDescription>
      </CardHeader>
      <CardContent>
        {dashboards.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("dashboardsEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {list.map((dashboard) => (
              <li
                key={dashboard.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
              >
                <DashboardIcon iconKey={dashboard.icon} className="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {dashboard.name}
                </span>
                <Badge variant="secondary" className="tabular-nums">
                  {t("widgetCount", {
                    count: dashboard.widgets.length,
                  })}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={
                    dashboard.isDefault
                      ? t("defaultAria", { name: dashboard.name })
                      : t("setDefaultAria", { name: dashboard.name })
                  }
                  title={
                    dashboard.isDefault
                      ? t("defaultAria", { name: dashboard.name })
                      : t("setDefaultAria", { name: dashboard.name })
                  }
                  disabled={dashboard.isDefault || patch.isPending}
                  onClick={() =>
                    void onToggleDefault(dashboard.id, dashboard.isDefault)
                  }
                >
                  <Star
                    className={cn(
                      "h-4 w-4",
                      dashboard.isDefault
                        ? "fill-current text-primary"
                        : "text-muted-foreground"
                    )}
                    aria-hidden="true"
                  />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={tDash("edit.deleteDashboard")}
                  title={tDash("edit.deleteDashboard")}
                  disabled={lastOne}
                  onClick={() => setConfirmDelete(dashboard.id)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {lastOne ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("lastDashboardHint")}
          </p>
        ) : null}

        <AlertDialog
          open={confirmDelete != null}
          onOpenChange={(open) => setConfirmDelete(open ? confirmDelete : null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {tDash("edit.deleteTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {tDash("edit.deleteDesc", { name: deleting?.name ?? "" })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tDash("edit.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void onDelete(confirmDelete ?? "")}
              >
                {tDash("edit.deleteDashboard")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

// ── 2. Templates ─────────────────────────────────────────────────────────────

function BuiltInTemplatesSection() {
  const tRoot = useTranslations();
  const t = useTranslations("dashboardsSettings");
  const dashboards = useDashboards();
  const create = useCreateDashboard();
  const apply = useApplyTemplate();
  const onError = useApiErrorToast();
  const { toast } = useToast();

  const list = dashboards.data?.dashboards ?? [];
  const current =
    list.find((d) => d.isDefault) ?? list[0] ?? null;

  const onAdd = async (templateKey: string, name: string, icon: string) => {
    try {
      await create.mutateAsync({ name, icon, templateKey });
      toast({ title: t("templateAddedToast", { name }) });
    } catch (error) {
      onError(error);
    }
  };

  const onReplace = async (templateKey: string) => {
    if (current == null) return;
    try {
      const result = await apply.mutateAsync({
        dashboardId: current.id,
        templateKey,
      });
      toast({
        title: t("templateReplacedToast", { name: current.name }),
        description:
          result.skipped.length > 0
            ? t("skippedToast", { count: result.skipped.length })
            : undefined,
      });
    } catch (error) {
      onError(error);
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {BUILT_IN_TEMPLATES.map((template) => {
        const first = template.dashboards[0];
        const chips = (first?.widgets ?? []).slice(0, 4);
        return (
          <Card key={template.key}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <DashboardIcon iconKey={first?.icon} className="h-4 w-4" />
                {tRoot(template.nameKey)}
              </CardTitle>
              <CardDescription>{tRoot(template.descriptionKey)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1">
                {chips.map((widget, i) => {
                  const def = getWidgetDefinition(widget.type);
                  return (
                    <Badge
                      key={`${widget.type}-${i}`}
                      variant="outline"
                      className="max-w-36 truncate font-normal text-muted-foreground"
                    >
                      {def ? tRoot(def.nameKey) : widget.type}
                    </Badge>
                  );
                })}
                {(first?.widgets.length ?? 0) > chips.length ? (
                  <Badge variant="outline" className="font-normal">
                    +{(first?.widgets.length ?? 0) - chips.length}
                  </Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={create.isPending}
                  onClick={() =>
                    void onAdd(
                      template.key,
                      tRoot(template.nameKey),
                      first?.icon ?? "layout-dashboard"
                    )
                  }
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("templateAdd")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={apply.isPending || current == null}
                  title={
                    current != null
                      ? t("templateReplaceTitle", { name: current.name })
                      : undefined
                  }
                  onClick={() => void onReplace(template.key)}
                >
                  {t("templateReplace")}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function MyTemplatesSection() {
  const t = useTranslations("dashboardsSettings");
  const templates = useUserTemplates();
  const del = useDeleteUserTemplate();
  const importDashboards = useImportDashboards();
  const dashboards = useDashboards();
  const saveTemplate = useSaveAsTemplate();
  const onError = useApiErrorToast();
  const { toast } = useToast();

  const list = templates.data ?? [];
  const dashboardList = dashboards.data?.dashboards ?? [];
  const [saveId, setSaveId] = React.useState<string>("");
  const [saveName, setSaveName] = React.useState("");
  const [applyingId, setApplyingId] = React.useState<string | null>(null);

  const effectiveSaveId =
    saveId !== "" && dashboardList.some((d) => d.id === saveId)
      ? saveId
      : (dashboardList[0]?.id ?? "");

  const onApplyAsNew = async (
    templateId: string,
    definition: unknown,
    name: string
  ) => {
    setApplyingId(templateId);
    try {
      const result = await importDashboards.mutateAsync(definition);
      toast({
        title: t("userTemplateAppliedToast", { name }),
        description:
          result.skipped.length > 0
            ? t("skippedToast", { count: result.skipped.length })
            : undefined,
      });
    } catch (error) {
      onError(error);
    } finally {
      setApplyingId(null);
    }
  };

  const onSave = async () => {
    if (effectiveSaveId === "" || saveName.trim() === "") return;
    try {
      await saveTemplate.mutateAsync({
        dashboardId: effectiveSaveId,
        name: saveName.trim(),
      });
      toast({ title: t("templateSavedToast") });
      setSaveName("");
    } catch (error) {
      onError(error);
    }
  };

  return (
    <div className="space-y-4">
      {templates.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : list.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          {t("userTemplatesEmpty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((template) => (
            <li
              key={template.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
            >
              <LayoutTemplate className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {template.name}
                </span>
                {template.description ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {template.description}
                  </span>
                ) : null}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={applyingId === template.id}
                onClick={() =>
                  void onApplyAsNew(template.id, template.definition, template.name)
                }
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {t("userTemplateApply")}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("userTemplateDelete")}
                onClick={() => void del.mutateAsync(template.id).catch(onError)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* Save current as template */}
      <div className="rounded-lg border border-dashed p-3">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">
          {t("saveAsTemplate")}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="space-y-1.5 sm:flex-1">
            <Label htmlFor="tpl-dashboard">{t("saveAsTemplateDashboard")}</Label>
            <Select
              value={effectiveSaveId}
              onValueChange={setSaveId}
              disabled={dashboardList.length === 0}
            >
              <SelectTrigger id="tpl-dashboard" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dashboardList.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:flex-1">
            <Label htmlFor="tpl-name">{t("saveAsTemplateName")}</Label>
            <Input
              id="tpl-name"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              maxLength={40}
              placeholder={t("saveAsTemplateNamePlaceholder")}
            />
          </div>
          <div className="flex items-end">
            <Button
              size="sm"
              disabled={
                saveName.trim() === "" ||
                effectiveSaveId === "" ||
                saveTemplate.isPending
              }
              onClick={() => void onSave()}
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              {t("saveAsTemplateButton")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 3. Import / export ───────────────────────────────────────────────────────

function ImportExportCard() {
  const t = useTranslations("dashboardsSettings");
  const dashboards = useDashboards();
  const importDashboards = useImportDashboards();
  const onError = useApiErrorToast();
  const { toast } = useToast();

  const list = dashboards.data?.dashboards ?? [];
  const [exportId, setExportId] = React.useState<string>("");
  const effectiveExportId =
    exportId !== "" && list.some((d) => d.id === exportId)
      ? exportId
      : (list[0]?.id ?? "");
  const [exporting, setExporting] = React.useState(false);
  const [skipped, setSkipped] = React.useState<
    Array<{
      dashboardIndex: number;
      widgetIndex: number;
      type: string;
      reason: string;
    }>
  >([]);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const onExport = async () => {
    if (effectiveExportId === "") return;
    setExporting(true);
    try {
      const payload = await fetchDashboardExport(effectiveExportId);
      const dashboard = list.find((d) => d.id === effectiveExportId);
      const name = (dashboard?.name ?? "dashboard")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `tradejournal-dashboard-${name || "export"}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast({ title: t("exportDoneToast") });
    } catch (error) {
      onError(error);
    } finally {
      setExporting(false);
    }
  };

  const onImportFile = async (file: File) => {
    if (file.size > DASHBOARD_IMPORT_MAX_BYTES) {
      toast({
        title: t("importTooLarge"),
        variant: "destructive",
      });
      return;
    }
    try {
      const text = await file.text();
      const json: unknown = JSON.parse(text);
      const result = await importDashboards.mutateAsync(json);
      setSkipped(result.skipped);
      toast({
        title: t("importDoneToast", {
          count: result.dashboards.length,
        }),
      });
    } catch (error) {
      onError(error);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("ioTitle")}</CardTitle>
        <CardDescription>{t("ioDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Export */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="space-y-1.5 sm:flex-1">
            <Label htmlFor="io-export">{t("exportSelect")}</Label>
            <Select
              value={effectiveExportId}
              onValueChange={setExportId}
              disabled={list.length === 0}
            >
              <SelectTrigger id="io-export" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {list.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name} ({d.widgets.length})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            disabled={effectiveExportId === "" || exporting}
            onClick={() => void onExport()}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {t("exportButton")}
          </Button>
        </div>

        {/* Import */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="space-y-1.5 sm:flex-1">
            <Label htmlFor="io-import">{t("importLabel")}</Label>
            <input
              ref={fileRef}
              id="io-import"
              type="file"
              accept="application/json,.json"
              className="w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:text-secondary-foreground hover:file:bg-accent"
              disabled={importDashboards.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onImportFile(file);
              }}
            />
            <p className="text-xs text-muted-foreground">{t("importHint")}</p>
          </div>
        </div>

        {skipped.length > 0 ? (
          <Alert variant="destructive">
            <AlertTitle>{t("importSkippedTitle")}</AlertTitle>
            <AlertDescription>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {skipped.map((item, i) => (
                  <li key={i} className="text-xs">
                    {t("importSkippedItem", {
                      dashboard: item.dashboardIndex + 1,
                      widget: item.widgetIndex + 1,
                      type: item.type === "" ? "—" : item.type,
                      reason: t(`skipReason.${item.reason}`),
                    })}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ── View ─────────────────────────────────────────────────────────────────────

export function DashboardsSettingsView() {
  const t = useTranslations("dashboardsSettings");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <YourDashboardsCard />

      <section aria-label={t("templatesTitle")} className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">{t("templatesTitle")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("templatesDesc")}
          </p>
        </div>
        <BuiltInTemplatesSection />
        <MyTemplatesSection />
      </section>

      <ImportExportCard />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {t("metricsTitle")}
          </CardTitle>
          <CardDescription>{t("metricsDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <CustomMetricsSection />
        </CardContent>
      </Card>
    </div>
  );
}
