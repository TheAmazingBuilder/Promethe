"use client";

/**
 * v3 — PNG card export dialog (normal / anonymous mode).
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { Download, ImageDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { downloadTradeCardPng } from "@/lib/export-image/card";
import type { TradeDetailDTO } from "@/lib/trading/dto";

export function ExportCardDialog({
  open,
  onOpenChange,
  trade,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trade: TradeDetailDTO;
}) {
  const t = useTranslations("exportCard");
  const { toast } = useToast();
  const [anonymous, setAnonymous] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setAnonymous(false);
      setBusy(false);
    }
  }, [open]);

  const download = async () => {
    setBusy(true);
    try {
      await downloadTradeCardPng(trade, { anonymous });
      toast({ title: t("toastDone") });
      onOpenChange(false);
    } catch {
      toast({ title: t("toastError"), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageDown className="h-4 w-4" aria-hidden="true" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("desc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="anon-mode" className="text-sm">
                {t("anonymous")}
              </Label>
              <p className="text-xs text-muted-foreground">{t("anonymousDesc")}</p>
            </div>
            <Switch
              id="anon-mode"
              checked={anonymous}
              onCheckedChange={setAnonymous}
            />
          </div>

          <Button className="w-full" onClick={() => void download()} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {t("rendering")}
              </>
            ) : (
              <>
                <Download className="h-4 w-4" aria-hidden="true" />
                {t("download")}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
