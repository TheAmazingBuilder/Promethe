"use client";

/**
 * v3 — /import: drag-and-drop history file wizard (v3 §4.2).
 * Parse in the browser (Web Worker) → preview → declare the timezone →
 * chunked upload with progress → result summary + error report CSV.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Info,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/hooks/use-toast";
import { useAccounts } from "@/hooks/use-trading";
import {
  downloadErrorReport,
  parseFileInWorker,
  useStartImport,
  type ImportOutcome,
  type ImportProgress,
} from "@/hooks/use-import";
import type { ParseResult } from "@/lib/import/types";
import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";

const TIMEZONES = [
  "UTC",
  "Europe/Paris",
  "Europe/London",
  "America/New_York",
  "America/Toronto",
  "America/Chicago",
  "Asia/Tokyo",
  "Asia/Dubai",
  "Australia/Sydney",
  "Etc/GMT-2",
  "Etc/GMT-3",
];

const MAX_PREVIEW_ROWS = 12;

export function ImportView() {
  const t = useTranslations("importWizard");
  const { data: accounts } = useAccounts();

  const [file, setFile] = React.useState<File | null>(null);
  const [parseResult, setParseResult] = React.useState<ParseResult | null>(null);
  const [parsing, setParsing] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [accountId, setAccountId] = React.useState("");
  const [timezone, setTimezone] = React.useState("UTC");
  const [progress, setProgress] = React.useState<ImportProgress>({ phase: "idle", percent: 0 });
  const [outcome, setOutcome] = React.useState<ImportOutcome | null>(null);

  const startImport = useStartImport(setProgress);

  React.useEffect(() => {
    if (accounts && accounts.length > 0 && !accountId) {
      setAccountId(accounts[0].id);
    }
  }, [accounts, accountId]);

  const onFile = React.useCallback(
    async (selected: File) => {
      setFile(selected);
      setParseResult(null);
      setOutcome(null);
      setProgress({ phase: "parsing", percent: 0 });
      setParsing(true);
      try {
        const result = await parseFileInWorker(selected);
        setParseResult(result);
        setProgress({ phase: "preview", percent: 0 });
      } catch (error) {
        setProgress({
          phase: "error",
          percent: 0,
          message: error instanceof Error ? error.message : "Analysis failed.",
        });
      } finally {
        setParsing(false);
      }
    },
    []
  );

  const onDrop = React.useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragOver(false);
      const dropped = event.dataTransfer.files?.[0];
      if (dropped) void onFile(dropped);
    },
    [onFile]
  );

  const submit = async () => {
    if (!file || !parseResult || !accountId) return;
    try {
      const result = await startImport.mutateAsync({
        accountId,
        serverTimezone: timezone,
        parseResult,
        file,
      });
      setOutcome(result.outcome);
    } catch (error) {
      setProgress({
        phase: "error",
        percent: 0,
        message: error instanceof Error ? error.message : "Import failed.",
      });
    }
  };

  const busy = progress.phase === "uploading" || progress.phase === "completing";

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label={t("dropzone")}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => document.getElementById("import-file-input")?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            document.getElementById("import-file-input")?.click();
          }
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
          dragOver ? "border-emerald-500/60 bg-emerald-500/5" : "border-border hover:bg-accent/50"
        )}
      >
        <input
          id="import-file-input"
          type="file"
          className="sr-only"
          accept=".csv,.txt,.tsv,.html,.htm,.xlsx"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) void onFile(selected);
          }}
        />
        {parsing ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{t("parsing")}</p>
          </>
        ) : file ? (
          <>
            <FileSpreadsheet className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(0)} KB
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => document.getElementById("import-file-input")?.click()}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
              {t("changeFile")}
            </Button>
          </>
        ) : (
          <>
            <Upload className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="font-medium">{t("dropzone")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("dropzoneHint")}</p>
            </div>
          </>
        )}
      </div>

      {/* Parse error */}
      {progress.phase === "error" && progress.message && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>{t("parseError")}</AlertTitle>
          <AlertDescription>{progress.message}</AlertDescription>
        </Alert>
      )}

      {/* Preview */}
      {parseResult && progress.phase !== "error" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {t("preview.title")}
              <Badge variant="secondary">{parseResult.formatLabel}</Badge>
            </CardTitle>
            <CardDescription>
              {t("preview.counts", {
                trades: parseResult.trades.length,
                cash: parseResult.cash.length,
                skipped: parseResult.skippedRows,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {parseResult.warnings.length > 0 && (
              <Alert>
                <Info className="h-4 w-4" aria-hidden="true" />
                <AlertTitle>{t("preview.warnings", { n: parseResult.warnings.length })}</AlertTitle>
                <AlertDescription>
                  {parseResult.warnings
                    .slice(0, 3)
                    .map((warning) => `${warning.code}${warning.row ? ` (ligne ${warning.row})` : ""}`)
                    .join(" · ")}
                </AlertDescription>
              </Alert>
            )}

            <div className="max-h-72 overflow-y-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("table.symbol")}</TableHead>
                    <TableHead>{t("table.direction")}</TableHead>
                    <TableHead>{t("table.volume")}</TableHead>
                    <TableHead>{t("table.open")}</TableHead>
                    <TableHead>{t("table.close")}</TableHead>
                    <TableHead className="text-right">{t("table.profit")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parseResult.trades.slice(0, MAX_PREVIEW_ROWS).map((trade) => (
                    <TableRow key={trade.externalId}>
                      <TableCell className="font-medium">{trade.symbol}</TableCell>
                      <TableCell>{trade.direction === "LONG" ? t("long") : t("short")}</TableCell>
                      <TableCell>{trade.volume}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{trade.openTime}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{trade.closeTime}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-medium",
                          Number(trade.profit) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                        )}
                      >
                        {trade.profit}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {parseResult.trades.length > MAX_PREVIEW_ROWS && (
              <p className="text-xs text-muted-foreground">
                {t("preview.moreRows", { n: parseResult.trades.length - MAX_PREVIEW_ROWS })}
              </p>
            )}

            {/* Target + timezone */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="import-account">{t("account")}</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger id="import-account">
                    <SelectValue placeholder={t("accountPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(accounts ?? []).map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="import-timezone">{t("timezone")}</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger id="import-timezone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((zone) => (
                      <SelectItem key={zone} value={zone}>
                        {zone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t("timezoneHint")}</p>
              </div>
            </div>

            {(progress.phase === "uploading" || progress.phase === "completing") && (
              <div className="space-y-2">
                <Progress value={progress.percent} aria-label={t("progress")} />
                <p className="text-xs text-muted-foreground">{progress.message}</p>
              </div>
            )}

            <Button
              className="w-full"
              onClick={submit}
              disabled={!accountId || busy || startImport.isPending}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {progress.message ?? t("importing")}
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t("importButton", { n: parseResult.trades.length })}
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Outcome */}
      {outcome && progress.phase === "done" && (
        <Card className="border-emerald-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              {t("done.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">{t("done.created")}</dt>
                <dd className="text-lg font-semibold">{outcome.created}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("done.updated")}</dt>
                <dd className="text-lg font-semibold">{outcome.updated}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("done.duplicates")}</dt>
                <dd className="text-lg font-semibold">{outcome.duplicates}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("done.manualSkipped")}</dt>
                <dd className="text-lg font-semibold">{outcome.manualSkipped}</dd>
              </div>
            </dl>

            {outcome.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <AlertTitle>{t("done.errors", { n: outcome.errors.length })}</AlertTitle>
                <AlertDescription>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => file && downloadErrorReport(outcome.errors, file.name)}
                  >
                    <Download className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                    {t("done.downloadErrors")}
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {outcome.reconciliationCreated > 0 && (
              <Alert>
                <Info className="h-4 w-4" aria-hidden="true" />
                <AlertTitle>
                  {t("done.reconciliation", { n: outcome.reconciliationCreated })}
                </AlertTitle>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => navigate("reconciliation")}
                >
                  {t("done.goReconciliation")}
                  <ArrowRight className="ml-2 h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </Alert>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setFile(null);
                  setParseResult(null);
                  setOutcome(null);
                  setProgress({ phase: "idle", percent: 0 });
                }}
              >
                <FileText className="mr-2 h-4 w-4" aria-hidden="true" />
                {t("done.another")}
              </Button>
              <Button variant="outline" onClick={() => navigate("trades")}>
                {t("done.goTrades")}
                <ArrowRight className="ml-2 h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Supported formats */}
      <Card className="bg-muted/30">
        <CardContent className="p-4 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{t("formats.title")}</p>
          <p className="mt-1">{t("formats.list")}</p>
          <p className="mt-2 italic">{t("formats.note")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
