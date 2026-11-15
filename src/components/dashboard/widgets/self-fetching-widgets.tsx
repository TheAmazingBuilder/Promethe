"use client";

/**
 * Self-fetching composite widgets — the existing cards render their own data
 * and handle their own empty states; the widget data payload is ignored.
 */
import { GoalsCard } from "@/components/rules/goals-card";
import { ViolationsCard } from "@/components/rules/violations-card";
import { PropStatusCard } from "@/components/dashboard/prop-status-card";
import { SyncStatusCard } from "@/components/dashboard/sync-status-card";

export function GoalsProgressWidget() {
  return (
    <div className="space-y-4">
      <GoalsCard />
      <ViolationsCard />
    </div>
  );
}

export function PropStatusWidget() {
  return <PropStatusCard />;
}

export function SyncStatusWidget() {
  return <SyncStatusCard />;
}
