"use client";

/**
 * Instruments view (v1 phase 7) — the 20 seeded presets (read-only, with the
 * XAUUSD pip convention note) + the user's custom instruments (full CRUD,
 * pipSize editable). Data: GET/POST /api/instruments · PATCH/DELETE [id].
 */
import * as React from "react";
import { Coins, Info, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateInstrument,
  useDeleteInstrument,
  useInstruments,
  useUpdateInstrument,
  type InstrumentApiDTO,
  type InstrumentInputBody,
} from "@/hooks/use-trading";
import { ApiClientError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";
import { ASSET_CLASSES, COMMON_CURRENCIES } from "@/lib/trading/types";
import { COMMON_TIMEZONES } from "@/lib/time/zones";

const CLASS_BADGE: Record<string, string> = {
  METAL: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  FOREX: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  INDEX: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  CRYPTO: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  COMMODITY: "bg-teal-500/15 text-teal-700 dark:text-teal-400",
  STOCK: "bg-pink-500/15 text-pink-700 dark:text-pink-400",
  FUTURES: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
};

const EMPTY: InstrumentInputBody = {
  symbol: "",
  name: "",
  assetClass: "FOREX",
  baseCurrency: null,
  quoteCurrency: "USD",
  digits: 5,
  pipSize: "0.0001",
  pointSize: "0.00001",
  contractSize: "100000",
  tickSize: null,
  tickValue: null,
  isActive: true,
  marketTimezone: null,
};

const POSITIVE = /^\d+(\.\d+)?$/;

function InstrumentEditor({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: InstrumentApiDTO | null;
}) {
  const t = useTranslations("instrumentsView.form");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const create = useCreateInstrument();
  const update = useUpdateInstrument();
  const [form, setForm] = React.useState<InstrumentInputBody>(EMPTY);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? {
            symbol: editing.symbol,
            name: editing.name,
            assetClass: editing.assetClass,
            baseCurrency: editing.baseCurrency,
            quoteCurrency: editing.quoteCurrency,
            digits: editing.digits,
            pipSize: editing.pipSize,
            pointSize: editing.pointSize,
            contractSize: editing.contractSize,
            tickSize: editing.tickSize,
            tickValue: editing.tickValue,
            isActive: editing.isActive,
            marketTimezone: editing.marketTimezone,
          }
        : EMPTY,
    );
  }, [open, editing]);

  const set = <K extends keyof InstrumentInputBody>(
    key: K,
    value: InstrumentInputBody[K]
  ) => setForm((f) => ({ ...f, [key]: value }));

  const onSave = async () => {
    setSaving(true);
    try {
      const payload: InstrumentInputBody = {
        ...form,
        symbol: form.symbol.trim().toUpperCase(),
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

  const decimalsOk =
    POSITIVE.test(form.pipSize.trim()) &&
    POSITIVE.test(form.pointSize.trim()) &&
    POSITIVE.test(form.contractSize.trim());
  const pipOk =
    POSITIVE.test(form.pipSize.trim()) &&
    Number(form.pipSize) > 0 &&
    Number(form.pipSize) < 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? t("editTitle") : t("createTitle")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {editing ? t("editTitle") : t("createTitle")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ins-symbol">{t("symbol")}</Label>
              <Input
                id="ins-symbol"
                value={form.symbol}
                onChange={(e) => set("symbol", e.target.value.toUpperCase())}
                placeholder="XAUUSD"
                maxLength={20}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ins-name">{t("name")}</Label>
              <Input
                id="ins-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder={t("namePlaceholder")}
                maxLength={80}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="ins-class">{t("assetClass")}</Label>
              <Select
                value={form.assetClass}
                onValueChange={(v) => set("assetClass", v)}
              >
                <SelectTrigger id="ins-class">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSET_CLASSES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ins-base">{t("baseCurrency")}</Label>
              <Select
                value={form.baseCurrency ?? "none"}
                onValueChange={(v) =>
                  set("baseCurrency", v === "none" ? null : v)
                }
              >
                <SelectTrigger id="ins-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">-</SelectItem>
                  {COMMON_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ins-quote">{t("quoteCurrency")}</Label>
              <Select
                value={form.quoteCurrency}
                onValueChange={(v) => set("quoteCurrency", v)}
              >
                <SelectTrigger id="ins-quote">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="ins-digits">{t("digits")}</Label>
              <Input
                id="ins-digits"
                inputMode="numeric"
                value={String(form.digits)}
                onChange={(e) =>
                  set("digits", Math.max(0, Math.min(10, Number(e.target.value) || 0)))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ins-pip">{t("pipSize")}</Label>
              <Input
                id="ins-pip"
                inputMode="decimal"
                value={form.pipSize}
                onChange={(e) => set("pipSize", e.target.value.trim())}
                placeholder="0.0001"
                aria-invalid={!pipOk && form.pipSize !== ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ins-point">{t("pointSize")}</Label>
              <Input
                id="ins-point"
                inputMode="decimal"
                value={form.pointSize}
                onChange={(e) => set("pointSize", e.target.value.trim())}
                placeholder="0.00001"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ins-contract">{t("contractSize")}</Label>
              <Input
                id="ins-contract"
                inputMode="decimal"
                value={form.contractSize}
                onChange={(e) => set("contractSize", e.target.value.trim())}
                placeholder="100000"
              />
            </div>
          </div>
          <p className="rounded-md border border-dashed p-2 text-[11px] text-muted-foreground">
            {t("pipHint")}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="ins-market-tz">{t("marketTimezone")}</Label>
            <Select
              value={form.marketTimezone ?? "none"}
              onValueChange={(v) =>
                set("marketTimezone", v === "none" ? null : v)
              }
            >
              <SelectTrigger id="ins-market-tz">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("marketTimezoneNone")}</SelectItem>
                {COMMON_TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {t("marketTimezoneHint")}
            </p>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="ins-active">{t("active")}</Label>
            <Switch
              id="ins-active"
              checked={form.isActive}
              onCheckedChange={(v) => set("isActive", v)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            onClick={() => void onSave()}
            disabled={
              saving ||
              form.symbol.trim() === "" ||
              form.name.trim() === "" ||
              !decimalsOk ||
              !pipOk
            }
          >
            {saving ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InstrumentsView() {
  const t = useTranslations("instrumentsView");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const { data, isLoading } = useInstruments();
  const del = useDeleteInstrument();

  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<InstrumentApiDTO | null>(null);
  const [search, setSearch] = React.useState("");

  const list = data ?? [];
  const presets = list.filter((i) => i.isPreset);
  const customs = list.filter((i) => !i.isPreset);
  const q = search.trim().toLowerCase();
  const match = (i: InstrumentApiDTO) =>
    q === "" ||
    i.symbol.toLowerCase().includes(q) ||
    i.name.toLowerCase().includes(q);

  const onEdit = (i: InstrumentApiDTO) => {
    setEditing(i);
    setEditorOpen(true);
  };
  const onCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const onDelete = async (i: InstrumentApiDTO) => {
    try {
      await del.mutateAsync(i.id);
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

  const shownPresets = presets.filter(match);
  const shownCustoms = customs.filter(match);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-40 sm:w-56"
            aria-label={t("searchPlaceholder")}
          />
          <Button onClick={onCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t("add")}</span>
          </Button>
        </div>
      </div>

      <Card className="border-dashed">
        <CardContent className="flex items-start gap-2.5 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">{t("xauNote")}</p>
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <div className="space-y-6">
          {/* ── Customs ── */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">
              {t("myInstruments", { count: shownCustoms.length })}
            </h3>
            {shownCustoms.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
                  <Coins className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground">{t("emptyCustom")}</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {shownCustoms.map((i) => (
                  <Card key={i.id} className={i.isActive ? "" : "opacity-60"}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <span className="font-mono text-sm">{i.symbol}</span>
                        <Badge className={CLASS_BADGE[i.assetClass] ?? ""}>
                          {i.assetClass}
                        </Badge>
                        {!i.isActive && (
                          <Badge variant="secondary">{t("inactiveBadge")}</Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="truncate">{i.name}</CardDescription>
                      <CardAction>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("edit")}
                            onClick={() => onEdit(i)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("delete")}
                            onClick={() => void onDelete(i)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardAction>
                    </CardHeader>
                    <CardContent>
                      <dl className="grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-4">
                        <div>
                          <dt className="text-muted-foreground">{t("pip")}</dt>
                          <dd className="font-mono tabular-nums">{i.pipSize}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">{t("digitsCol")}</dt>
                          <dd className="tabular-nums">{i.digits}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">{t("contract")}</dt>
                          <dd className="font-mono tabular-nums">
                            {i.contractSize}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">{t("pair")}</dt>
                          <dd className="tabular-nums">
                            {i.baseCurrency ? `${i.baseCurrency}/` : ""}
                            {i.quoteCurrency}
                          </dd>
                        </div>
                        {i.marketTimezone != null && (
                          <div>
                            <dt className="text-muted-foreground">{t("marketTimezoneShort")}</dt>
                            <dd className="truncate tabular-nums" title={i.marketTimezone}>
                              {i.marketTimezone}
                            </dd>
                          </div>
                        )}
                      </dl>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* ── Presets (read-only) ── */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">
              {t("presets", { count: shownPresets.length })}
            </h3>
            <Card className="py-4">
              <CardContent className="px-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th scope="col" className="py-2 pr-3 font-medium">
                          {t("symbol")}
                        </th>
                        <th scope="col" className="py-2 pr-3 font-medium">
                          {t("name")}
                        </th>
                        <th scope="col" className="py-2 pr-3 font-medium">
                          {t("assetClass")}
                        </th>
                        <th scope="col" className="py-2 pr-3 font-medium">
                          {t("pip")}
                        </th>
                        <th scope="col" className="py-2 pr-3 font-medium">
                          {t("contract")}
                        </th>
                        <th scope="col" className="py-2 pr-3 font-medium">
                          {t("marketTimezoneShort")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownPresets.map((i) => (
                        <tr key={i.id} className="border-b last:border-0">
                          <td className="py-2 pr-3 font-mono font-medium">
                            {i.symbol}
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground">
                            {i.name}
                          </td>
                          <td className="py-2 pr-3">
                            <Badge
                              className={CLASS_BADGE[i.assetClass] ?? ""}
                            >
                              {i.assetClass}
                            </Badge>
                          </td>
                          <td className="py-2 pr-3 font-mono tabular-nums text-muted-foreground">
                            {i.pipSize}
                          </td>
                          <td className="py-2 pr-3 font-mono tabular-nums text-muted-foreground">
                            {i.contractSize}
                          </td>
                          <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                            {i.marketTimezone ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("presetHint")}
                </p>
              </CardContent>
            </Card>
          </section>
        </div>
      )}

      <InstrumentEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
      />
    </div>
  );
}
