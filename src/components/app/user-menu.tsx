"use client";

import * as React from "react";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSession } from "./session-context";
import { navigate } from "@/lib/router";
import { useToast } from "@/hooks/use-toast";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function UserMenu() {
  const { session, logout } = useSession();
  const { toast } = useToast();
  const t = useTranslations("shell");
  const tRoot = useTranslations();
  const [loggingOut, setLoggingOut] = React.useState(false);

  if (!session) return null;
  const { displayName, timezone } = session.profile;

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      toast({ title: t("loggedOutTitle"), description: t("loggedOutDesc") });
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 gap-2 px-2"
          aria-label={`${t("userMenu")} - ${initials(displayName)} ${displayName}`}
        >
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-emerald-500/15 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              {initials(displayName)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-[10rem] truncate text-sm md:block">
            {displayName}
          </span>
          <ChevronDown
            className="h-3.5 w-3.5 text-muted-foreground"
            aria-hidden="true"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium">{displayName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {session.user.email}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("timezone", { timezone })}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("#/reglages")}>
          <Settings aria-hidden="true" />
          {tRoot("nav.settings")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={handleLogout}
          disabled={loggingOut}
        >
          <LogOut aria-hidden="true" />
          {loggingOut ? t("logoutLoading") : t("logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
