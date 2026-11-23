"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useCreateJournalTemplate,
  useDeleteJournalTemplate,
  useJournalTemplates,
} from "@/hooks/use-journal";
import type { JournalTemplateDTO, JournalTemplateInput } from "@/hooks/use-journal";

type PreparationValues = Omit<JournalTemplateInput, "name" | "description">;

export function JournalTemplateControls({
  values,
  onApply,
}: {
  values: PreparationValues;
  onApply: (template: JournalTemplateDTO) => void;
}) {
  const { data: templates = [], isLoading } = useJournalTemplates();
  const create = useCreateJournalTemplate();
  const remove = useDeleteJournalTemplate();
  const [name, setName] = React.useState("");
  const [selectedId, setSelectedId] = React.useState("");
  const [status, setStatus] = React.useState("");
  const selected = templates.find((template) => template.id === selectedId);

  const handleSave = async () => {
    if (!name.trim()) return;
    try {
      const template = await create.mutateAsync({ name: name.trim(), ...values });
      setSelectedId(template.id);
      setName("");
      setStatus("Template saved.");
    } catch {
      setStatus("Could not save this template. Check its name and try again.");
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    try {
      await remove.mutateAsync(selected.id);
      setSelectedId("");
      setStatus("Template deleted.");
    } catch {
      setStatus("Could not delete this template.");
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-muted/15 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Preparation templates</p>
          <p className="text-xs text-muted-foreground">Save and reuse your daily market preparation. Playbook strategy checklists remain separate.</p>
        </div>
        <Badge variant="outline">{templates.length} saved</Badge>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          aria-label="Select a Journal preparation template"
          className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={isLoading || templates.length === 0}
        >
          <option value="">{isLoading ? "Loading templates…" : templates.length ? "Choose a saved template" : "No saved templates"}</option>
          {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
        <Button size="sm" variant="outline" disabled={!selected} onClick={() => selected && onApply(selected)}>Apply</Button>
        <Button size="sm" variant="ghost" disabled={!selected || remove.isPending} onClick={() => void handleDelete()}>Delete</Button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name this preparation template…" maxLength={60} className="h-10 flex-1" />
        <Button size="sm" disabled={!name.trim() || create.isPending} onClick={() => void handleSave()}>
          {create.isPending ? "Saving…" : "Save current plan"}
        </Button>
      </div>
      <p className="min-h-4 text-xs text-muted-foreground" aria-live="polite">{status}</p>
    </div>
  );
}
