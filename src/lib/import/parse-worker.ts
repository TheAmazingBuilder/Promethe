/// <reference lib="webworker" />
/**
 * v3 — Import parsing Web Worker: the heavy parsing (CSV/HTML/XLSX) runs
 * off the main thread; only normalized rows are sent back and only chunks
 * of ≤ 200 rows ever hit the server (4.5 MB serverless limit, v3 §4.2).
 */
import { parseImportFile, type ImportFileContent, type ParseResult } from "./index";

export interface WorkerRequest {
  id: number;
  content: ImportFileContent;
}

export type WorkerResponse =
  | { id: number; ok: true; result: ParseResult }
  | { id: number; ok: false; code: string; message: string };

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const { id, content } = event.data;
  try {
    const result = parseImportFile(content);
    const response: WorkerResponse = { id, ok: true, result };
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      id,
      ok: false,
      code: error instanceof Error && "code" in error ? String((error as { code: string }).code) : "PARSE_FAILED",
      message: error instanceof Error ? error.message : "Analysis failed.",
    };
    self.postMessage(response);
  }
});
