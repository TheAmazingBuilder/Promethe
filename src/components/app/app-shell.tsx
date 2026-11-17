"use client";

import * as React from "react";
import { Crosshair, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ModeToggle } from "@/components/mode-toggle";
import { PrivacyToggle } from "@/components/privacy/privacy-toggle";
import { BrandMark } from "./brand";
import { NavList } from "./nav-list";
import { UserMenu } from "./user-menu";
import { CommandMenu } from "./command-menu";
import { TourProvider } from "@/components/tour/guided-tour";
import { ShortcutsProvider } from "@/components/shortcuts/shortcuts-provider";
import { useShortcuts } from "@/hooks/use-productivity";
import {
  effectiveKeys,
  isTypingTarget,
  matchesChord,
} from "@/lib/shortcuts/registry";
import { NotificationsBell } from "./notifications-bell";
import { DeletionBanner } from "./deletion-banner";
import { findNavItem } from "./nav";
import { navigate, useHashRoute, type ViewId } from "@/lib/router";

/**
 * Application shell — shadcn collapsible sidebar (icon rail) + two-tone
 * header (black brand block, toolbar with sidebar trigger, separator and
 * breadcrumb) + main area + sticky footer. Mobile navigation is provided
 * by the sidebar component itself (Sheet drawer).
 */
export function AppShell({
  children,
  defaultSidebarOpen = true,
}: {
  children: React.ReactNode;
  defaultSidebarOpen?: boolean;
}) {
  const route = useHashRoute();
  const t = useTranslations("shell");
  const tRoot = useTranslations();
  const tPhase = useTranslations("common");
  const [commandOpen, setCommandOpen] = React.useState(false);
  // v2.5 Module 4 — stored shortcut overrides (defaults while loading).
  const shortcuts = useShortcuts();
  const overrides = shortcuts.data ?? [];

  const activeNavView: ViewId =
    route.view === "trade" || route.view === "trade-form"
      ? "trades"
      : route.view === "mentor-owner" || route.view === "mentor-trade"
        ? "mentor"
        : route.view;
  const navItem = findNavItem(activeNavView);
  const pageTitle = navItem ? tRoot(navItem.labelKey) : "Promethe";

  // ⌘K / Ctrl+K toggles the command palette (chord is reassignable).
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesChord(event, effectiveKeys("command-palette", overrides))) return;
      event.preventDefault();
      setCommandOpen((v) => !v);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overrides]);

  // Bare "f"/"F" enters focus mode (v2.5 M1) — no modifiers, not while
  // typing in a field and no overlay open (pragmatic dialog check).
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesChord(event, effectiveKeys("focus-mode", overrides))) return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector("[data-state=open]") != null) return;
      if (window.location.hash === "#/focus") return;
      event.preventDefault();
      navigate("#/focus");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overrides]);

  return (
    <TourProvider>
      <ShortcutsProvider>
      <SidebarProvider defaultOpen={defaultSidebarOpen}>
      {/* ── Sidebar (black brand block + nav, collapses to an icon rail) ── */}
      <Sidebar collapsible="icon" aria-label={t("sidebarLabel")}>
        <SidebarHeader className="border-b border-sidebar-border">
          <div className="flex h-14 items-center px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <a href="#/" aria-label="Promethe - Home" className="min-w-0">
              <BrandMark />
            </a>
          </div>
        </SidebarHeader>
        <SidebarContent data-tour="nav">
          <NavList activeView={activeNavView} />
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border px-4 py-3">
          <p className="text-[11px] leading-relaxed text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
            {t("sidebarNote1")}
            <br />
            {t("sidebarNote2")}
          </p>
        </SidebarFooter>
      </Sidebar>

      {/* ── Content column ── */}
      <SidebarInset>
        <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          {/* a11y (M8 Phase 5): wraps at 200 % text scale / narrow viewports
              (WCAG 1.4.10) instead of overflowing horizontally. */}
          <div className="flex min-h-14 flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2 sm:px-6">
            <SidebarTrigger aria-label={t("openNav")} />
            <Separator
              orientation="vertical"
              className="mr-1 data-[orientation=vertical]:h-4"
            />
            <Breadcrumb className="min-w-0">
              <BreadcrumbList className="sm:gap-2.5">
                <BreadcrumbItem className="hidden sm:inline-flex">
                  <BreadcrumbLink asChild>
                    <a href="#/">{t("breadcrumbHome")}</a>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden sm:inline-flex" />
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbPage className="truncate font-medium">
                    {pageTitle}
                  </BreadcrumbPage>
                </BreadcrumbItem>
                {navItem && navItem.phase !== null && !navItem.ready && (
                  <BreadcrumbItem>
                    <Badge
                      variant="secondary"
                      className="tabular-nums"
                    >
                      {tPhase("phase", { phase: navItem.phase })}
                    </Badge>
                  </BreadcrumbItem>
                )}
              </BreadcrumbList>
            </Breadcrumb>
            <h1 className="sr-only">{pageTitle}</h1>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 text-muted-foreground hidden sm:inline-flex"
                onClick={() => navigate("#/focus")}
                aria-label={t("focus")}
                title={t("focusHint")}
              >
                <Crosshair className="h-4 w-4" aria-hidden="true" />
                <span className="hidden text-xs lg:inline">{t("focus")}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 text-muted-foreground"
                onClick={() => setCommandOpen(true)}
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                <span className="hidden text-xs sm:inline">{t("search")}</span>
                <span className="sr-only">- {t("openCommandMenu")}</span>
                <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline" aria-hidden="true">
                  ⌘K
                </kbd>
              </Button>
              <PrivacyToggle />
              <NotificationsBell />
              <ModeToggle />
              <UserMenu />
            </div>
          </div>
        </header>

        {/* ── Main ── */}
        <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <DeletionBanner />
          {children}
        </div>

        {/* ── Footer (sticky bottom, pushed naturally on overflow) ── */}
        <footer className="mt-auto border-t bg-background">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-1.5 px-4 py-3.5 text-xs text-muted-foreground sm:flex-row sm:px-6">
            <p>
              <span className="font-medium text-foreground">Promethe</span>{" "}
              {t("footerLeft")}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
              <a
                href="#/legal/mentions"
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                {t("legalMentions")}
              </a>
              <span aria-hidden="true">·</span>
              <a
                href="#/legal/confidentialite"
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                {t("legalPrivacy")}
              </a>
              <span aria-hidden="true">·</span>
              <a
                href="#/legal/cookies"
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                {t("legalCookies")}
              </a>
              <span aria-hidden="true" className="hidden sm:inline">·</span>
              <p className="tabular-nums">{t("footerRight")}</p>
            </div>
          </div>
        </footer>
      </SidebarInset>

      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
      </SidebarProvider>
      </ShortcutsProvider>
    </TourProvider>
  );
}
