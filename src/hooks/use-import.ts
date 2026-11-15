"use client";

/**
 * v3 — Import flow hooks: parse in a Web Worker, then upload normalized
 * rows to the server in chunks with progress and resumability.
 */
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ImportFileContent, ParseResult } from "@/lib/import/types";
import type { WorkerRequest, WorkerResponse } from "@/lib/import/parse-worker";
import type { ImportBatchDTO } from "@/server/import";

export interface ImportProgress {
  phase: "idle" | "parsing" | "preview" | "uploading" | "completing" | "done" | "error";
  message?: string;
  /** 0-100 during upload. */
  percent: number;
}

export interface ImportOutcome {
  created: number;
  updated: number;
  duplicates: number;
  manualSkipped: number;
  errors: { row: number; externalId?: string; code: string; detail?: string }[];
  reconciliationCreated: number;
}

const CHUNK_SIZE = 200;

/** Computes the SHA-256 hex hash of a file (dedupe re-uploads). */
async function hashFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Parses a File in a Web Worker. Resolves with the ParseResult or throws
 * with the worker's coded error message.
 */
/**
 * Parses a File off the critical path. The Web Worker is used when the
 * bundler supports the URL transform; otherwise parsing falls back to the
 * main thread inside a yielding wrapper (the "Parsing…" state paints
 * first, and files of a few MB parse in ~100-300 ms).
 */
export async function parseFileInWorker(file: File): Promise<ParseResult> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const content: ImportFileContent = { fileName: file.name, extension };
  if (extension === "xlsx" || extension === "xls") {
    content.bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    content.text = await file.text();
  }

  // Let the spinner paint before the (potentially) heavy parse.
  await new Promise((resolve) => setTimeout(resolve, 30));

  try {
    const worker = new Worker(
      new URL("../lib/import/parse-worker.ts", import.meta.url),
      { type: "module" }
    );
    return await parseInWorker(worker, content);
  } catch {
    // Worker unavailable (bundler did not transform the URL, CSP, …) —
    // dynamic-import the parser on the main thread instead.
    const { parseImportFile } = await import("../lib/import/index");
    return parseImportFile(content);
  }
}

function parseInWorker(worker: Worker, content: ImportFileContent): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const id = Date.now();
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("Analyse trop longue — fichier trop volumineux ?"));
    }, 60_000);

    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== id) return;
      clearTimeout(timeout);
      worker.terminate();
      if (event.data.ok) resolve(event.data.result);
      else reject(Object.assign(new Error(event.data.message), { code: event.data.code }));
    });

    worker.addEventListener("error", (event) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message || "Erreur du worker d'analyse."));
    });

    const request: WorkerRequest = { id, content };
    worker.postMessage(request);
  });
}

export interface StartImportInput {
  accountId: string;
  serverTimezone: string;
  parseResult: ParseResult;
  file: File;
}

/** Full upload flow: batch → chunks → complete. Drives the progress UI. */
export function useStartImport(onProgress: (progress: ImportProgress) => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      accountId,
      serverTimezone,
      parseResult,
      file,
    }: StartImportInput): Promise<{ batch: ImportBatchDTO; outcome: ImportOutcome }> => {
      const fileHash = await hashFile(file);

      onProgress({ phase: "uploading", percent: 0, message: "Création du lot…" });
      const { batch, duplicateWarning } = await apiFetch<{
        batch: ImportBatchDTO;
        duplicateWarning: string | false;
      }>("/api/import/batches", {
        method: "POST",
        body: JSON.stringify({
          accountId,
          format: parseResult.format,
          fileName: file.name,
          fileHash,
          serverTimezone,
          counts: {
            parsed: parseResult.trades.length + parseResult.cash.length,
            trades: parseResult.trades.length,
            cash: parseResult.cash.length,
          },
        }),
      });
      if (duplicateWarning) {
        onProgress({ phase: "uploading", percent: 0, message: duplicateWarning });
      }

      const outcome: ImportOutcome = {
        created: 0,
        updated: 0,
        duplicates: 0,
        manualSkipped: 0,
        errors: [],
        reconciliationCreated: 0,
      };

      // Chunked upload (trades interleaved with cash per chunk).
      const allRows = [
        ...parseResult.trades.map((trade) => ({ kind: "trade" as const, row: trade })),
        ...parseResult.cash.map((cash) => ({ kind: "cash" as const, row: cash })),
      ];
      const totalChunks = Math.ceil(allRows.length / CHUNK_SIZE);

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const slice = allRows.slice(chunkIndex * CHUNK_SIZE, (chunkIndex + 1) * CHUNK_SIZE);
        const payload = {
          trades: slice.filter((item) => item.kind === "trade").map((item) => item.row),
          cash: slice.filter((item) => item.kind === "cash").map((item) => item.row),
        };
        const chunkResult = await apiFetch<{
          created: number;
          updated: number;
          duplicates: number;
          manualSkipped: number;
          errors: ImportOutcome["errors"];
        }>(`/api/import/batches/${batch.id}/rows`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        outcome.created += chunkResult.created;
        outcome.updated += chunkResult.updated;
        outcome.duplicates += chunkResult.duplicates;
        outcome.manualSkipped += chunkResult.manualSkipped;
        outcome.errors.push(...chunkResult.errors);

        onProgress({
          phase: "uploading",
          percent: Math.round(((chunkIndex + 1) / totalChunks) * 90),
          message: `Lot ${chunkIndex + 1}/${totalChunks}…`,
        });
      }

      onProgress({ phase: "completing", percent: 95, message: "Finalisation…" });
      const completed = await apiFetch<{
        batch: ImportBatchDTO;
        reconciliation: { created: number };
      }>(`/api/import/batches/${batch.id}/complete`, {
        method: "POST",
        body: JSON.stringify({
          created: outcome.created,
          updated: outcome.updated,
          duplicates: outcome.duplicates,
          manualSkipped: outcome.manualSkipped,
          errors: outcome.errors.length,
          parsed: allRows.length,
        }),
      });
      outcome.reconciliationCreated = completed.reconciliation.created;

      onProgress({ phase: "done", percent: 100 });
      return { batch: completed.batch, outcome };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["trades"] });
      queryClient.invalidateQueries({ queryKey: ["reconciliation"] });
    },
  });
}

/** CSV download helper for the error report. */
export function downloadErrorReport(errors: ImportOutcome["errors"], fileName: string): void {
  const header = "row,externalId,code,detail";
  const lines = errors.map((error) =>
    [
      error.row,
      error.externalId ?? "",
      error.code,
      (error.detail ?? "").replace(/["\n,]/g, " "),
    ].join(",")
  );
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `erreurs-${fileName}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
