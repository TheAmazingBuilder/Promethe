"use client";

import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { CustomFieldDefinitionDTO } from "@/lib/trading/dto";

/**
 * Custom-field inputs for the trade form (v2.5 Module 4 §4.7) - one
 * control per active definition, typed by the definition's type.
 * Values are kept in a record keyed by definition key; empty values are
 * removed from the record (the server stores only non-empty values).
 */
export function CustomFieldInputs({
  definitions,
  values,
  onChange,
}: {
  definitions: CustomFieldDefinitionDTO[];
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const setValue = (key: string, value: unknown) => {
    const next = { ...values };
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onChange(next);
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {definitions.map((def) => {
        const value = values[def.key];
        const label = (
          <Label htmlFor={`cf-${def.key}`}>
            {def.label}
            {def.required ? " *" : ""}
          </Label>
        );
        switch (def.type) {
          case "LONG_TEXT":
            return (
              <div key={def.key} className="space-y-1.5 sm:col-span-2">
                {label}
                <Textarea
                  id={`cf-${def.key}`}
                  value={typeof value === "string" ? value : ""}
                  onChange={(e) => setValue(def.key, e.target.value)}
                />
              </div>
            );
          case "NUMBER":
          case "DECIMAL": {
            const step = def.type === "DECIMAL" ? "any" : "1";
            return (
              <div key={def.key} className="space-y-1.5">
                {label}
                <Input
                  id={`cf-${def.key}`}
                  type="number"
                  step={step}
                  value={value === undefined || value === null ? "" : String(value)}
                  onChange={(e) =>
                    setValue(
                      def.key,
                      e.target.value === "" ? undefined : Number(e.target.value)
                    )
                  }
                />
              </div>
            );
          }
          case "SELECT":
            return (
              <div key={def.key} className="space-y-1.5">
                {label}
                <Select
                  value={typeof value === "string" ? value : ""}
                  onValueChange={(v) => setValue(def.key, v)}
                >
                  <SelectTrigger id={`cf-${def.key}`} className="w-full">
                    <SelectValue placeholder="-" />
                  </SelectTrigger>
                  <SelectContent>
                    {(def.options ?? []).map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          case "MULTI_SELECT": {
            const selected = Array.isArray(value) ? (value as unknown[]).map(String) : [];
            return (
              <div key={def.key} className="space-y-1.5 sm:col-span-2">
                {label}
                <div className="flex flex-wrap gap-2">
                  {(def.options ?? []).map((o) => (
                    <label
                      key={o}
                      className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                    >
                      <Checkbox
                        checked={selected.includes(o)}
                        onCheckedChange={(v) =>
                          setValue(
                            def.key,
                            v
                              ? [...selected, o]
                              : selected.filter((x) => x !== o)
                          )
                        }
                      />
                      {o}
                    </label>
                  ))}
                </div>
              </div>
            );
          }
          case "CHECKBOX":
            return (
              <div
                key={def.key}
                className="flex min-h-10 items-center justify-between gap-3 rounded-lg border px-3"
              >
                <Label htmlFor={`cf-${def.key}`} className="cursor-pointer font-normal">
                  {def.label}
                  {def.required ? " *" : ""}
                </Label>
                <Switch
                  id={`cf-${def.key}`}
                  checked={value === true}
                  onCheckedChange={(v) => setValue(def.key, v)}
                />
              </div>
            );
          case "DATE":
            return (
              <div key={def.key} className="space-y-1.5">
                {label}
                <DateField
                  id={`cf-${def.key}`}
                  className="h-9"
                  value={typeof value === "string" ? value : ""}
                  onChange={(v) => setValue(def.key, v)}
                />
              </div>
            );
          case "URL":
            return (
              <div key={def.key} className="space-y-1.5">
                {label}
                <Input
                  id={`cf-${def.key}`}
                  type="url"
                  value={typeof value === "string" ? value : ""}
                  onChange={(e) => setValue(def.key, e.target.value)}
                />
              </div>
            );
          case "TEXT":
          default:
            return (
              <div key={def.key} className="space-y-1.5">
                {label}
                <Input
                  id={`cf-${def.key}`}
                  value={typeof value === "string" ? value : ""}
                  onChange={(e) => setValue(def.key, e.target.value)}
                />
              </div>
            );
        }
      })}
    </div>
  );
}
