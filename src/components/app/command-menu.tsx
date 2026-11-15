"use client";

import * as React from "react";
import { EyeOff, LogOut, PencilRuler, SunMoon } from "lucide-react";
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

/** ⌘K / Ctrl+K command palette — navigation + quick actions. */
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
      onOpenChange={onOpenChange}
      title={t("commandTitle")}
      description={t("commandDesc")}
    >
      <CommandInput placeholder={t("commandPlaceholder")} />
      <CommandList>
        <CommandEmpty>{t("commandEmpty")}</CommandEmpty>
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
