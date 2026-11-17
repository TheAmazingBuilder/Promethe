"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Keyboard, Loader2, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  useResetShortcuts,
  useShortcuts,
  useUpsertShortcut,
} from "@/hooks/use-productivity";
import {
  SHORTCUT_ACTIONS,
  effectiveKeys,
  eventChord,
  findConflicts,
  formatChord,
  type ShortcutAction,
} from "@/lib/shortcuts/registry";
import { useI18n } from "@/i18n/i18n-provider";
import { apiErrorMessage } from "@/lib/i18n-errors";
import { ApiClientError } from "@/lib/api-client";
import type { ShortcutDTO } from "@/lib/trading/dto";

/**
 * #/reglages/raccourcis - reassignable shortcuts (v2.5 Module 4 §4.1).
 * Click "Modifier", press the new keys, conflicts are shown before
 * saving. The privacy shortcut is managed in the privacy settings
 * (shown here read-only). Reset restores every registry default.
 */
export function ShortcutsView() {
  const t = useTranslations("shortcutsView");
  const tRoot = useTranslations();
  const tCommon = useTranslations("common");
  const { locale } = useI18n();
  const { toast } = useToast();
  const shortcuts = useShortcuts();
  const upsert = useUpsertShortcut();
  const reset = useResetShortcuts();
  const [capturing, setCapturing] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState<{
    actionId: string;
    chord: string;
    withAction: ShortcutAction;
  } | null>(null);

  const overrides = shortcuts.data ?? [];
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

  // Capture the next keydown as the new chord for `capturing`.
  React.useEffect(() => {
    if (!capturing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setCapturing(null);
        return;
      }
      const chord = eventChord(event);
      if (!chord) return;
      const clash = findConflicts(chord, capturing, overrides);
      if (clash.length > 0) {
        setConflict({ actionId: capturing, chord, withAction: clash[0] });
        setCapturing(null);
        return;
      }
      upsert.mutate(
        { actionId: capturing, keys: chord },
        {
          onSuccess: () => {
            toast({ title: t("savedToast") });
            setCapturing(null);
          },
          onError: errorToast,
        }
      );
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  const categories: Array<{ key: string; actions: ShortcutAction[] }> = [
    {
      key: "navigation",
      actions: SHORTCUT_ACTIONS.filter((a) => a.category === "navigation"),
    },
    {
      key: "actions",
      actions: SHORTCUT_ACTIONS.filter((a) => a.category === "actions"),
    },
    {
      key: "display",
      actions: SHORTCUT_ACTIONS.filter((a) => a.category === "display"),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button
          variant="outline"
          disabled={reset.isPending}
          onClick={() =>
            reset.mutate(undefined, {
              onSuccess: () => toast({ title: t("resetToast") }),
              onError: errorToast,
            })
          }
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {t("reset")}
        </Button>
      </div>

      {shortcuts.isLoading ? (
        <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>
      ) : (
        categories.map((cat) => (
          <Card key={cat.key}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Keyboard className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {t(`categories.${cat.key}`)}
              </CardTitle>
              <CardDescription>{t(`categories.${cat.key}Desc`)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {cat.actions.map((action) => {
                const keys = effectiveKeys(action.id, overrides);
                const isDefault =
                  overrides.find((o: ShortcutDTO) => o.actionId === action.id)
                    ?.isDefault ?? true;
                return (
                  <div
                    key={action.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {t(action.labelKey)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t(action.descKey)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="outline" className="font-mono">
                        {formatChord(keys, locale)}
                      </Badge>
                      {!isDefault && (
                        <Badge variant="secondary">{t("custom")}</Badge>
                      )}
                      {action.editable ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={upsert.isPending}
                          onClick={() => {
                            setConflict(null);
                            setCapturing(action.id);
                          }}
                        >
                          {capturing === action.id
                            ? t("pressKeys")
                            : t("change")}
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" asChild>
                          <a href="#/reglages/privacy">{t("manageInPrivacy")}</a>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))
      )}

      {conflict && (
        <Card className="border-destructive">
          <CardContent className="space-y-3 px-4 py-4">
            <p className="text-sm font-medium">
              {t("conflictTitle", {
                chord: formatChord(conflict.chord, locale),
                action: t(conflict.withAction.labelKey),
              })}
            </p>
            <p className="text-sm text-muted-foreground">{t("conflictDesc")}</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConflict(null)}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                size="sm"
                disabled={upsert.isPending}
                onClick={() => {
                  const c = conflict;
                  setConflict(null);
                  upsert.mutate(
                    { actionId: c.actionId, keys: c.chord },
                    {
                      onSuccess: () => toast({ title: t("savedToast") }),
                      onError: errorToast,
                    }
                  );
                }}
              >
                {upsert.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                {t("replaceAnyway")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
