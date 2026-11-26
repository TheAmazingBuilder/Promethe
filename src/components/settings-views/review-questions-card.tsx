"use client";

import * as React from "react";
import { Archive, ArchiveRestore, Loader2, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCreateReviewQuestion, useReviewQuestions, useUpdateReviewQuestion } from "@/hooks/use-trade-review";
import type { ReviewQuestionTemplateDTO } from "@/lib/trading/dto";

type QuestionType = ReviewQuestionTemplateDTO["type"];
const TYPE_LABELS: Record<QuestionType, string> = { SCALE: "Score (1–5)", BOOLEAN: "Yes / No", TEXT: "Written answer" };

export function ReviewQuestionsSettingsCard() {
  const { toast } = useToast();
  const query = useReviewQuestions(true);
  const create = useCreateReviewQuestion();
  const update = useUpdateReviewQuestion();
  const [editing, setEditing] = React.useState<ReviewQuestionTemplateDTO | null>(null);
  const [open, setOpen] = React.useState(false);
  const [question, setQuestion] = React.useState("");
  const [type, setType] = React.useState<QuestionType>("SCALE");
  const items = query.data ?? [];
  const activeCount = items.filter((item) => item.isActive).length;
  const pending = create.isPending || update.isPending;

  const openNew = () => { setEditing(null); setQuestion(""); setType("SCALE"); setOpen(true); };
  const openEdit = (item: ReviewQuestionTemplateDTO) => { setEditing(item); setQuestion(item.question); setType(item.type); setOpen(true); };
  const save = () => {
    if (editing) update.mutate({ id: editing.id, patch: { question: question.trim(), type } }, {
      onSuccess: () => { toast({ title: "Review question updated." }); setOpen(false); },
      onError: () => toast({ title: "Could not save this question.", variant: "destructive" }),
    });
    else create.mutate({ question: question.trim(), type }, {
      onSuccess: () => { toast({ title: "Review question added." }); setOpen(false); },
      onError: () => toast({ title: "You can have up to 20 active questions.", variant: "destructive" }),
    });
  };
  const toggleActive = (item: ReviewQuestionTemplateDTO) => update.mutate(
    { id: item.id, patch: { isActive: !item.isActive } },
    {
      onSuccess: () => toast({ title: item.isActive ? "Question deactivated. Existing answers are preserved." : "Question reactivated." }),
      onError: () => toast({ title: "You can have up to 20 active questions.", variant: "destructive" }),
    },
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Custom review questions</CardTitle>
          <CardDescription>Create prompts that appear in every trade review. Saved answers keep their original question text.</CardDescription>
          <p className="text-xs text-muted-foreground">{activeCount}/20 active questions</p>
        </div>
        <Button onClick={openNew} disabled={activeCount >= 20}><Plus className="h-4 w-4" aria-hidden="true" />Add question</Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {query.isLoading ? <p className="text-sm text-muted-foreground">Loading questions…</p> :
          items.length === 0 ? <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">No custom review questions yet.</p> :
          items.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-3">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">{item.question}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{TYPE_LABELS[item.type]}</Badge>
                  {!item.isActive && <Badge variant="secondary">Inactive</Badge>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="icon" aria-label="Edit question" onClick={() => openEdit(item)}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
                <Button variant="ghost" size="icon" aria-label={item.isActive ? "Deactivate question" : "Reactivate question"} disabled={update.isPending} onClick={() => toggleActive(item)}>
                  {item.isActive ? <Archive className="h-4 w-4" aria-hidden="true" /> : <ArchiveRestore className="h-4 w-4" aria-hidden="true" />}
                </Button>
              </div>
            </div>
          ))}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit review question" : "New review question"}</DialogTitle>
            <DialogDescription>Choose a question and the kind of answer you want to record.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="review-question">Question</Label>
              <Input id="review-question" value={question} maxLength={180} placeholder="e.g. Did I wait for a valid confirmation?" onChange={(event) => setQuestion(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="review-question-type">Answer type</Label>
              <Select value={type} onValueChange={(value) => setType(value as QuestionType)}>
                <SelectTrigger id="review-question-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SCALE">{TYPE_LABELS.SCALE}</SelectItem>
                  <SelectItem value="BOOLEAN">{TYPE_LABELS.BOOLEAN}</SelectItem>
                  <SelectItem value="TEXT">{TYPE_LABELS.TEXT}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!question.trim() || pending} onClick={save}>{pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Save question</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
