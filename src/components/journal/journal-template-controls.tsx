"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useCreateJournalTemplate,
  useDeleteJournalTemplate,
  useJournalTemplates,
  useUpdateJournalTemplate,
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
  const update = useUpdateJournalTemplate();
  const remove = useDeleteJournalTemplate();
  const [name, setName] = React.useState("");
  const [selectedId, setSelectedId] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const selected = templates.find((template) => template.id === selectedId);

  const handleSave = async () => {
    if (!name.trim()) return;
    try {
      if (editing && selected) {
        await update.mutateAsync({
          id: selected.id,
          patch: { name: name.trim(), ...values },
        });
        setEditing(false);
        setStatus("Template updated with the current preparation.");
      } else {
        const template = await create.mutateAsync({ name: name.trim(), ...values });
        setSelectedId(template.id);
        setStatus("Template saved.");
      }
      setName("");
    } catch {
      setStatus("Could not save this template. Check its name and try again.");
    }
  };

  const handleEdit = () => {
    if (!selected) return;
    setName(selected.name);
    setEditing(true);
    setStatus("Update the daily preparation fields, then save the selected template.");
  };

  const handleSetDefault = async () => {
    if (!selected) return;
    try {
      await update.mutateAsync({ id: selected.id, patch: { isDefault: true } });
      setStatus("Default template updated.");
    } catch {
      setStatus("Could not set this template as the default.");
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete the "${selected.name}" preparation template?`)) return;
    try {
      await remove.mutateAsync(selected.id);
      setSelectedId("");
      setEditing(false);
      setName("");
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
          onChange={(event) => {
            setSelectedId(event.target.value);
            setEditing(false);
            setName("");
            setStatus("");
          }}
          aria-label="Select a Journal preparation template"
          className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={isLoading || templates.length === 0}
        >
          <option value="">{isLoading ? "Loading templates…" : templates.length ? "Choose a saved template" : "No saved templates"}</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.isDefault ? "★ " : ""}{template.name}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" disabled={!selected} onClick={() => selected && onApply(selected)}>Apply</Button>
        <Button size="sm" variant="outline" disabled={!selected || update.isPending} onClick={handleEdit}>Edit</Button>
        <Button size="sm" variant="ghost" disabled={!selected || selected.isDefault || update.isPending} onClick={() => void handleSetDefault()}>
          {selected?.isDefault ? "Default" : "Set default"}
        </Button>
        <Button size="sm" variant="ghost" disabled={!selected || remove.isPending} onClick={() => void handleDelete()}>Delete</Button>
      </div>
      {editing && selected ? (
        <div className="rounded-lg border border-primary/30 bg-background/70 p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            The template will be updated from the current preparation fields above. Your existing Journal entry is not saved by this action.
          </p>
        </div>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={editing ? "Rename this template…" : "Name this preparation template…"}
          maxLength={60}
          className="h-10 flex-1"
        />
        <Button size="sm" disabled={!name.trim() || create.isPending || update.isPending} onClick={() => void handleSave()}>
          {create.isPending || update.isPending ? "Saving…" : editing ? "Save template changes" : "Save current plan"}
        </Button>
        {editing ? <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setName(""); }}>Cancel</Button> : null}
      </div>
      <p className="min-h-4 text-xs text-muted-foreground" aria-live="polite">{status}</p>
    </div>
  );
}
