"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { History, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/hooks/use-toast";
import { useHistory, useUndoGroup } from "@/hooks/use-productivity";
import { apiErrorMessage } from "@/lib/i18n-errors";
import { ApiClientError } from "@/lib/api-client";
import type { ChangeLogGroupDTO } from "@/lib/trading/dto";

/**
 * /history - change history (v2.5 Module 4 §4.5). One row per undoable
 * action (bulk edit or delete, single deletes included). Undo restores
 * the BEFORE snapshots and marks the group undone. Entries expire
 * after 30 days.
 */
export function HistoryView() {
  const t = useTranslations("historyView");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const history = useHistory(50);
  const undo = useUndoGroup();
  const groups = history.data ?? [];
  const onUndo = (group: ChangeLogGroupDTO) => {
    undo.mutate(group.groupId, {
      onSuccess: (res) => {
        toast({
          title: t("undoneToast", { count: res.restored }),
        });
      },
      onError: (err) => {
        const e = err as ApiClientError;
        toast({
          title: apiErrorMessage(
            tRoot,
            e?.code,
            err instanceof Error ? err.message : ""
          ),
          variant: "destructive",
        });
      },
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {history.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : history.isError ? (
        <Card className="gap-0 py-4">
          <CardContent className="px-4">
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("loadError")}
            </p>
          </CardContent>
        </Card>
      ) : groups.length === 0 ? (
        <Card className="gap-0 py-4">
          <CardContent className="px-4">
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <History className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => {
            const expired = new Date(group.expiresAt) <= new Date();
            const canUndo = !group.undoneAt && !expired;
            return (
              <Card key={group.groupId} className="gap-0 py-3">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {group.action === "DELETE" ? (
                        <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                      ) : (
                        <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      )}
                      {group.action === "DELETE"
                        ? t("actionDelete", { count: group.count })
                        : t("actionBulk", { count: group.count })}
                      {group.undoneAt && (
                        <Badge variant="secondary">{t("undone")}</Badge>
                      )}
                      {expired && !group.undoneAt && (
                        <Badge variant="outline">{t("expired")}</Badge>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(group.createdAt).toLocaleString()} -{" "}
                      {t("expires", {
                        date: new Date(group.expiresAt).toLocaleDateString(),
                      })}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canUndo || undo.isPending}
                    onClick={() => onUndo(group)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("undo")}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
