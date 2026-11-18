"use client";

/**
 * v3 Phase 5 — Mentor permissions editor (shared by the invite form and the
 * access edit dialog). Pure controlled component over MentorPermissionsDTO.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { MentorPermissionsDTO } from "@/lib/mentor/dto";

export interface RefOption {
  id: string;
  name: string;
}

export const DEFAULT_PERMISSIONS: MentorPermissionsDTO = {
  accountScope: "ALL",
  accountIds: [],
  strategyScope: "ALL",
  strategyIds: [],
  canViewAmounts: true,
  canViewJournal: false,
  canViewScreenshots: false,
  canViewAnalytics: true,
  canComment: false,
  expiresAt: null,
};

export function PermissionsEditor({
  value,
  onChange,
  accounts,
  strategies,
}: {
  value: MentorPermissionsDTO;
  onChange: (next: MentorPermissionsDTO) => void;
  accounts: RefOption[];
  strategies: RefOption[];
}) {
  const t = useTranslations("mentors");

  const toggle = (key: keyof MentorPermissionsDTO) => (checked: boolean) =>
    onChange({ ...value, [key]: checked });

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="perm-accounts" className="text-sm">
            {t("permAccounts")}
          </Label>
          <select
            id="perm-accounts"
            value={value.accountScope}
            onChange={(e) =>
              onChange({
                ...value,
                accountScope: e.target.value as "ALL" | "LIST",
              })
            }
            className="h-8 rounded-md border bg-background px-2 text-xs"
            aria-label={t("permAccounts")}
          >
            <option value="ALL">{t("permAccountsAll")}</option>
            <option value="LIST">{t("permAccountsList")}</option>
          </select>
        </div>
        {value.accountScope === "LIST" && (
          <div className="grid gap-1.5 rounded-md border p-2.5 sm:grid-cols-2">
            {accounts.length === 0 && (
              <p className="text-xs text-muted-foreground">-</p>
            )}
            {accounts.map((account) => (
              <label
                key={account.id}
                className="flex items-center gap-2 text-xs"
              >
                <input
                  type="checkbox"
                  checked={value.accountIds.includes(account.id)}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      accountIds: e.target.checked
                        ? [...value.accountIds, account.id]
                        : value.accountIds.filter((id) => id !== account.id),
                    })
                  }
                  className="h-3.5 w-3.5 accent-emerald-600"
                />
                <span className="truncate">{account.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="perm-strategies" className="text-sm">
            {t("permStrategies")}
          </Label>
          <select
            id="perm-strategies"
            value={value.strategyScope}
            onChange={(e) =>
              onChange({
                ...value,
                strategyScope: e.target.value as "ALL" | "LIST",
              })
            }
            className="h-8 rounded-md border bg-background px-2 text-xs"
            aria-label={t("permStrategies")}
          >
            <option value="ALL">{t("permStrategiesAll")}</option>
            <option value="LIST">{t("permStrategiesList")}</option>
          </select>
        </div>
        {value.strategyScope === "LIST" && (
          <div className="grid max-h-40 gap-1.5 overflow-y-auto rounded-md border p-2.5 sm:grid-cols-2">
            {strategies.length === 0 && (
              <p className="text-xs text-muted-foreground">-</p>
            )}
            {strategies.map((strategy) => (
              <label
                key={strategy.id}
                className="flex items-center gap-2 text-xs"
              >
                <input
                  type="checkbox"
                  checked={value.strategyIds.includes(strategy.id)}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      strategyIds: e.target.checked
                        ? [...value.strategyIds, strategy.id]
                        : value.strategyIds.filter((id) => id !== strategy.id),
                    })
                  }
                  className="h-3.5 w-3.5 accent-emerald-600"
                />
                <span className="truncate">{strategy.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-2.5 rounded-md border p-3 sm:grid-cols-2">
        <PermissionSwitch
          label={t("permAmounts")}
          checked={value.canViewAmounts}
          onCheckedChange={toggle("canViewAmounts")}
        />
        <PermissionSwitch
          label={t("permJournal")}
          checked={value.canViewJournal}
          onCheckedChange={toggle("canViewJournal")}
        />
        <PermissionSwitch
          label={t("permScreenshots")}
          checked={value.canViewScreenshots}
          onCheckedChange={toggle("canViewScreenshots")}
        />
        <PermissionSwitch
          label={t("permAnalytics")}
          checked={value.canViewAnalytics}
          onCheckedChange={toggle("canViewAnalytics")}
        />
        <PermissionSwitch
          label={t("permComment")}
          checked={value.canComment}
          onCheckedChange={toggle("canComment")}
        />
      </div>
    </div>
  );
}

function PermissionSwitch({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}
