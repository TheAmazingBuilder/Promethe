"use client";

/**
 * v3 Phase 5 — Notification bell (in-app center). Polls the feed, shows the
 * unread count, click navigates to the deep link and marks the row read.
 * Feed entries are typed server strings (FR default — documented trade-off).
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-client";
import { navigate } from "@/lib/router";

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string | null;
  sentAt: string;
  readAt: string | null;
}

export function NotificationsBell() {
  const t = useTranslations("notif");
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);

  const feed = useQuery({
    queryKey: ["notifications"],
    queryFn: () =>
      apiFetch<{ notifications: NotificationRow[]; unreadCount: number }>(
        "/api/v1/notifications"
      ),
    refetchInterval: 60_000,
  });

  async function openItem(row: NotificationRow): Promise<void> {
    setOpen(false);
    if (!row.readAt) {
      await apiFetch("/api/v1/notifications", {
        method: "PATCH",
        body: JSON.stringify({ id: row.id }),
      }).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
    if (row.url) {
      navigate(`#${row.url}`);
    }
  }

  async function markAll(): Promise<void> {
    await apiFetch("/api/v1/notifications", {
      method: "PATCH",
      body: JSON.stringify({ all: true }),
    }).catch(() => undefined);
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  const unread = feed.data?.unreadCount ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `${t("open")} - ${unread}` : t("open")}
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {unread > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-semibold leading-none text-white"
            >
              <span aria-hidden="true">{unread > 9 ? "9+" : unread}</span>
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">{t("title")}</p>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => void markAll()}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {t("markAll")}
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {!feed.data || feed.data.notifications.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t("empty")}
            </p>
          ) : (
            <ul>
              {feed.data.notifications.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => void openItem(row)}
                    className={cn(
                      "w-full border-b px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-accent",
                      !row.readAt && "bg-emerald-500/5"
                    )}
                  >
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {!row.readAt && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600"
                          aria-hidden="true"
                        />
                      )}
                      {row.title}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {row.body}
                    </p>
                    <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
                      {format(new Date(row.sentAt), "d MMM · HH:mm")}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
