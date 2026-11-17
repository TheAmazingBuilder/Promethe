"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { NAV_GROUPS } from "./nav";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { apiFetch } from "@/lib/api-client";
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
    queryFn: () => apiFetch<MentorHomePayload>("/api/mentor"),
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
                        <a
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
                        </a>
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
