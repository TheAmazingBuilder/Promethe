"use client";

import * as React from "react";
import {
  CandlestickChart,
  EyeOff,
  History,
  Keyboard,
  ListChecks,
  LogOut,
  NotebookPen,
  PencilRuler,
  Search as SearchIcon,
  SunMoon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { NAV_GROUPS } from "./nav";
import { useSession } from "./session-context";
import { navigate } from "@/lib/router";
import { useToast } from "@/hooks/use-toast";
import { usePrivacyPreferences } from "@/components/privacy/privacy-provider";
import { useGlobalSearch } from "@/hooks/use-productivity";

/** ⌘K / Ctrl+K command palette - navigation + quick actions. */
export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { logout } = useSession();
  const { resolvedTheme, setTheme } = useTheme();
  const { toast } = useToast();
  const t = useTranslations("shell");
  const tRoot = useTranslations();
  const tPrivacy = useTranslations("privacy");
  const { preferences, setMode, isPresenting, stopPresenting, startPresenting } =
    usePrivacyPreferences();
  // v2.5 Module 4 — live global search inside the palette (Cmd+K).
  const [searchQuery, setSearchQuery] = React.useState("");
  const liveSearch = useGlobalSearch(searchQuery, 5);
  const liveResults = liveSearch.data;
  const liveItems = [
    ...(liveResults?.trades ?? []).map((r) => ({ ...r, icon: CandlestickChart })),
    ...(liveResults?.strategies ?? []).map((r) => ({ ...r, icon: ListChecks })),
    ...(liveResults?.journal ?? []).map((r) => ({ ...r, icon: NotebookPen })),
  ];

  const go = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };

  const toggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
    onOpenChange(false);
  };

  const doLogout = () => {
    onOpenChange(false);
    void logout().then(() =>
      toast({ title: t("loggedOutTitle"), description: t("loggedOutDesc") })
    );
  };

  /** Navigate home and ask the dashboard view to enter edit mode. */
  const customizeDashboard = () => {
    onOpenChange(false);
    navigate("#/");
    // Let the dashboard view mount before the event is dispatched.
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("tj:customize-dashboard"));
    }, 80);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSearchQuery("");
        onOpenChange(next);
      }}
      title={t("commandTitle")}
      description={t("commandDesc")}
    >
      <CommandInput
        placeholder={t("commandPlaceholder")}
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      <CommandList>
        <CommandEmpty>{t("commandEmpty")}</CommandEmpty>
        {liveItems.length > 0 && (
          <>
            <CommandGroup heading={t("commandSearchResults")}>
              {liveItems.map((item) => (
                <CommandItem
                  key={`${item.entity}-${item.id}`}
                  value={`${item.title} ${item.snippet}`}
                  onSelect={() => go(item.href)}
                >
                  <item.icon aria-hidden="true" />
                  <span className="truncate">{item.title}</span>
                </CommandItem>
              ))}
              <CommandItem
                value={t("commandSeeAllResults")}
                onSelect={() =>
                  go(`#/search?q=${encodeURIComponent(searchQuery.trim())}`)
                }
              >
                <SearchIcon aria-hidden="true" />
                {t("commandSeeAllResults")}
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}
        <CommandGroup heading={t("commandNav")}>
          {NAV_GROUPS.flatMap((group) => group.items).map((item) => (
            <CommandItem
              key={item.path}
              value={`${tRoot(item.labelKey)} ${tRoot(item.descriptionKey)}`}
              onSelect={() => go(item.path)}
            >
              <item.icon aria-hidden="true" />
              <span>{tRoot(item.labelKey)}</span>
              {item.phase !== null && !item.ready && (
                <CommandShortcut>P{item.phase}</CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={t("commandActions")}>
          <CommandItem onSelect={() => go("#/search")}>
            <SearchIcon aria-hidden="true" />
            {t("commandGoSearch")}
          </CommandItem>
          <CommandItem onSelect={() => go("#/history")}>
            <History aria-hidden="true" />
            {t("commandGoHistory")}
          </CommandItem>
          <CommandItem onSelect={() => go("#/reglages/raccourcis")}>
            <Keyboard aria-hidden="true" />
            {t("commandGoShortcuts")}
          </CommandItem>
          <CommandItem onSelect={customizeDashboard}>
            <PencilRuler aria-hidden="true" />
            {t("commandCustomizeDashboard")}
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setMode(preferences.mode === "OFF" ? "HIDE" : "OFF");
              onOpenChange(false);
            }}
          >
            <EyeOff aria-hidden="true" />
            {preferences.mode === "OFF"
              ? tPrivacy("hideAmounts")
              : tPrivacy("showAmounts")}
            <CommandShortcut>
              {preferences.shortcut.toUpperCase()}
            </CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              if (isPresenting) {
                stopPresenting();
              } else {
                startPresenting();
              }
              onOpenChange(false);
            }}
          >
            <EyeOff aria-hidden="true" />
            {isPresenting
              ? tPrivacy("stopPresenting")
              : tPrivacy("startPresenting")}
          </CommandItem>
          <CommandItem onSelect={toggleTheme}>
            <SunMoon aria-hidden="true" />
            {t("commandToggleTheme")}
          </CommandItem>
          <CommandItem onSelect={doLogout}>
            <LogOut aria-hidden="true" />
            {t("logout")}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
