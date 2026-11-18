"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { isGroupExpanded, NAV_GROUPS, type NavGroup } from "./nav";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { apiFetch } from "@/lib/api-client";
import Link from "next/link";
import type { MenteeSummaryDTO, ReceivedInvitationDTO } from "@/lib/mentor/dto";
import type { ViewId } from "@/lib/router";

interface MentorHomePayload {
  mentees: MenteeSummaryDTO[];
  invitations: ReceivedInvitationDTO[];
  isMentor: boolean;
}

/** Shared query - identical key AND queryFn everywhere (cache coherent). */
export function useMentorHome() {
  return useQuery({
    queryKey: ["mentor-space"],
    queryFn: () => apiFetch<MentorHomePayload>("/api/v1/mentor"),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/**
 * Whether the current user mentors at least one trader (drives the
 * "Mentor space" nav visibility). Lightweight: one small GET, cached.
 */
export function useIsMentor(): boolean {
  const { data } = useMentorHome();
  return data?.isMentor === true;
}

/** localStorage key for the Data group collapse state (collapsed by default). */
export const DATA_GROUP_COLLAPSED_KEY = "promethe.sidebar.data-collapsed";

/**
 * Collapsed state persisted per device. Defaults to collapsed; storage
 * failures (private mode) fall back to in-memory state.
 */
function usePersistedCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const raw = window.localStorage.getItem(DATA_GROUP_COLLAPSED_KEY);
      return raw === null ? true : raw === "true";
    } catch {
      return true;
    }
  });
  const toggle = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(DATA_GROUP_COLLAPSED_KEY, String(next));
      } catch {
        // Storage unavailable - in-memory state still works.
      }
      return next;
    });
  }, []);
  return [collapsed, toggle];
}

/**
 * A nav group rendered as one collapsible parent row (icon + label +
 * chevron) with its pages as sub-entries. Collapsed by default; when one
 * of its pages is the active route the parent is highlighted and the
 * group auto-expands, so the active page is never hidden behind a
 * collapse. In the icon rail the label and chevron hide and a click first
 * re-opens the full sidebar so the sub-entries are visible.
 */
function CollapsibleNavGroup({
  group,
  activeView,
  onNavigate,
}: {
  group: NavGroup;
  activeView: ViewId;
  onNavigate?: () => void;
}) {
  const t = useTranslations();
  const isMentor = useIsMentor();
  const { state: sidebarState, setOpen } = useSidebar();
  const [storedCollapsed, toggleCollapsed] = usePersistedCollapsed();

  const items = group.items.filter((item) => !item.mentorOnly || isMentor);
  if (!items.length) return null;
  const containsActive = items.some((item) => item.view === activeView);
  const expanded = isGroupExpanded(storedCollapsed, containsActive);
  const GroupIcon = group.icon;
  const subListId = `nav-sub-${group.labelKey.replace(/[^a-zA-Z0-9]/g, "-")}`;

  const handleToggle = () => {
    if (sidebarState === "collapsed") setOpen(true);
    toggleCollapsed();
  };

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={containsActive}
              onClick={handleToggle}
              aria-expanded={expanded}
              aria-controls={subListId}
              tooltip={t("nav.dataDesc")}
              className="relative data-[active=true]:font-medium data-[active=true]:text-emerald-700 dark:data-[active=true]:text-emerald-400"
            >
              {GroupIcon ? <GroupIcon aria-hidden="true" /> : null}
              <span className="group-data-[collapsible=icon]:hidden">
                {t(group.labelKey)}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={`ml-auto shrink-0 transition-transform duration-200 motion-reduce:transition-none group-data-[collapsible=icon]:hidden ${
                  expanded ? "" : "-rotate-90"
                }`}
              />
            </SidebarMenuButton>
            {expanded ? (
              <SidebarMenuSub id={subListId}>
                {items.map((item) => {
                  const isActive = activeView === item.view;
                  return (
                    <SidebarMenuSubItem key={item.path}>
                      <SidebarMenuSubButton
                        asChild
                        isActive={isActive}
                        className="data-[active=true]:font-medium data-[active=true]:text-emerald-700 dark:data-[active=true]:text-emerald-400"
                      >
                        <Link
                          href={item.path}
                          onClick={onNavigate}
                          aria-current={isActive ? "page" : undefined}
                        >
                          <item.icon aria-hidden="true" />
                          <span>{t(item.labelKey)}</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  );
                })}
              </SidebarMenuSub>
            ) : null}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/**
 * Navigation list — sidebar menu with icon-rail support (tooltips shown
 * when the sidebar is collapsed). Shared by the desktop sidebar and the
 * mobile sheet (both rendered by the sidebar component).
 */
export function NavList({
  activeView,
  onNavigate,
}: {
  activeView: ViewId;
  onNavigate?: () => void;
}) {
  const t = useTranslations();
  const isMentor = useIsMentor();
  const reduceMotion = useReducedMotion();
  // Scoped per NavList instance (desktop sidebar + mobile sheet can both
  // be mounted) so the shared layoutId never collides across instances.
  const pillId = React.useId();

  return (
    <>
      {NAV_GROUPS.map((group) => {
        if (group.collapsible) {
          return (
            <CollapsibleNavGroup
              key={group.labelKey}
              group={group}
              activeView={activeView}
              onNavigate={onNavigate}
            />
          );
        }
        const items = group.items.filter(
          (item) => !item.mentorOnly || isMentor
        );
        if (!items.length) return null;
        return (
          <SidebarGroup key={group.labelKey}>
            <SidebarGroupLabel>{t(group.labelKey)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map((item) => {
                  const isActive = activeView === item.view;
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={t(item.descriptionKey)}
                        className="relative data-[active=true]:font-medium data-[active=true]:text-emerald-700 dark:data-[active=true]:text-emerald-400"
                      >
                        <Link
                          href={item.path}
                          onClick={onNavigate}
                          aria-current={isActive ? "page" : undefined}
                        >
                          {/* Sliding active pill - one shared element that
                              glides between items (plain span when reduced
                              motion is on). Rendered first so it paints
                              under the icon and label. */}
                          {isActive ? (
                            reduceMotion ? (
                              <span
                                className="absolute inset-0 rounded-md bg-emerald-500/10"
                                aria-hidden="true"
                              />
                            ) : (
                              <motion.span
                                layoutId={`nav-active-pill-${pillId}`}
                                className="absolute inset-0 rounded-md bg-emerald-500/10"
                                aria-hidden="true"
                                transition={{
                                  type: "spring",
                                  stiffness: 500,
                                  damping: 40,
                                }}
                              />
                            )
                          ) : null}
                          <item.icon aria-hidden="true" />
                          <span>{t(item.labelKey)}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        );
      })}
    </>
  );
}
