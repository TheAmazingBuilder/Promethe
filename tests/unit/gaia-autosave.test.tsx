// @vitest-environment jsdom
/**
 * Gaia autosave race - deterministic tests with deferred PATCH promises
 * and fake timers (dossier §7.3 / §9.4).
 *
 * The editor debounces edits by 900 ms, serializes PATCHes, and only
 * clears the dirty flag when the local revision still matches the sent
 * one. These tests drive the real GaiaEditor with a mocked update
 * mutation whose promise resolves only when the test says so, so a
 * change-during-request, an out-of-order response and a failed save are
 * all reproducible without real timing.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/i18n-provider";
import { GaiaEditor } from "@/components/gaia/gaia-editor";
import type { GaiaNote } from "@/components/gaia/gaia-shared";

const NOTE_ID = "note-autosave-1";

const SERVER_NOTE: GaiaNote = {
  id: NOTE_ID,
  userId: "user-1",
  title: "Autosave note",
  icon: null,
  folderId: null,
  tagIds: [],
  favorite: false,
  templateId: null,
  lessonRef: null,
  blocks: [{ id: "b1", type: "paragraph", text: "hello" }],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastViewedAt: null,
  deletedAt: null,
};

type PatchResult = {
  note: GaiaNote;
  folderName: string | null;
  tagNames: string[];
};

function patchResult(updatedAt: string): PatchResult {
  return {
    note: { ...SERVER_NOTE, updatedAt },
    folderName: null,
    tagNames: [],
  };
}

const mutateAsync = vi.fn();

vi.mock("@/components/gaia/gaia-shared", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/gaia/gaia-shared")>();
  return {
    ...actual,
    useGaiaNote: () => ({
      data: { note: SERVER_NOTE, folderName: null, tagNames: [] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    }),
    // §25.5: useGaiaFolders/useGaiaTags now return the unwrapped arrays
    // (fetchReferenceWithFallback), not the { folders } / { tags } wrapper.
    useGaiaFolders: () => ({ data: [] }),
    useGaiaTags: () => ({ data: [] }),
    useGaiaTemplates: () => ({ data: { templates: [] } }),
    useGaiaLinkedNotes: () => ({ data: { notes: [], total: 0 } }),
    useGaiaVersions: () => ({ data: { versions: [] } }),
    useGaiaVersion: () => ({ data: null }),
    useGaiaRefs: () => ({ data: { refs: [] } }),
    useUpdateGaiaNote: () => ({ mutateAsync, isPending: false }),
    useTrashGaiaNote: () => ({ mutateAsync: vi.fn() }),
    useDuplicateGaiaNote: () => ({ mutateAsync: vi.fn() }),
    useCreateGaiaTag: () => ({ mutateAsync: vi.fn() }),
    useCreateGaiaTemplate: () => ({ mutateAsync: vi.fn() }),
    useRestoreGaiaVersion: () => ({ mutateAsync: vi.fn() }),
    useCreateGaiaNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

vi.mock("@/lib/router", () => ({ navigate: vi.fn() }));

let deferred: {
  promise: Promise<PatchResult>;
  resolve: (value: PatchResult) => void;
  reject: (reason: unknown) => void;
} | null = null;

function deferPatch() {
  let resolve!: (value: PatchResult) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<PatchResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  deferred = { promise, resolve, reject };
  return deferred;
}

function renderEditor() {
  return render(
    <I18nProvider>
      <GaiaEditor
        noteId={NOTE_ID}
        onClose={() => undefined}
        onOpenNote={() => undefined}
        focusMode={false}
        onToggleFocusMode={() => undefined}
      />
    </I18nProvider>,
  );
}

function saveStatus() {
  return screen.getByTestId("gaia-save-status").getAttribute("data-status");
}

function editText(value: string) {
  // The paragraph block is the only textarea in the editor; its value
  // changes with every edit, so look it up by element, not by value.
  const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
  expect(textarea).toBeTruthy();
  fireEvent.change(textarea!, { target: { value } });
}

function patchBlocksText(callIndex: number): string {
  const call = mutateAsync.mock.calls[callIndex]?.[0] as
    | { patch?: { blocks?: Array<{ text?: string }> } }
    | undefined;
  return call?.patch?.blocks?.[0]?.text ?? "";
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  mutateAsync.mockReset();
  deferred = null;
  // Every PATCH gets a fresh deferred promise: a rejected first attempt
  // must not poison the retry.
  mutateAsync.mockImplementation(() => deferPatch().promise);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Gaia autosave race", () => {
  it("marks the note saved when nothing changes during the request", async () => {
    renderEditor();
    expect(screen.getByDisplayValue("hello")).toBeTruthy();

    editText("hello world");
    expect(saveStatus()).toBe("dirty");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(saveStatus()).toBe("saving");
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(patchBlocksText(0)).toBe("hello world");

    await act(async () => {
      deferred!.resolve(patchResult("2026-11-26T10:00:00.000Z"));
    });
    expect(saveStatus()).toBe("saved");
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("keeps dirty and saves again when the text changes during the request", async () => {
    renderEditor();
    editText("hello world");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    // Change while the first PATCH is still in flight. The visible label
    // stays "saving" (a request is running); the change is tracked by the
    // revision counter, and the dirty flag is what the save checks.
    editText("hello world again");
    expect(saveStatus()).toBe("saving");

    await act(async () => {
      deferred!.resolve(patchResult("2026-11-26T10:00:00.000Z"));
    });
    // The first save succeeded but the draft moved on: dirty stays true
    // and a second save is scheduled with the latest text.
    expect(saveStatus()).toBe("dirty");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(patchBlocksText(1)).toBe("hello world again");

    await act(async () => {
      deferred!.resolve(patchResult("2026-11-26T10:01:00.000Z"));
    });
    expect(saveStatus()).toBe("saved");
  });

  it("never runs two PATCHes at once: a flush during a request is skipped, then replayed", async () => {
    renderEditor();
    editText("hello world");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    editText("hello world again");
    // The pending 900 ms timer fires while the first PATCH is in flight:
    // the flush must be skipped, not run concurrently.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    // Once the first PATCH resolves, the skipped save is replayed
    // immediately with the latest text.
    await act(async () => {
      deferred!.resolve(patchResult("2026-11-26T10:00:00.000Z"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(patchBlocksText(1)).toBe("hello world again");

    await act(async () => {
      deferred!.resolve(patchResult("2026-11-26T10:01:00.000Z"));
    });
    expect(saveStatus()).toBe("saved");
  });

  it("keeps dirty on a network error and retries on its own after the backoff", async () => {
    renderEditor();
    editText("hello world");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred!.reject(new Error("Network down"));
    });
    expect(saveStatus()).toBe("error");
    // The failed save is retried on its own after the first 5 s backoff.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(patchBlocksText(1)).toBe("hello world");

    await act(async () => {
      deferred!.resolve(patchResult("2026-11-26T10:00:00.000Z"));
    });
    expect(saveStatus()).toBe("saved");
  });

  it("flushes pending edits on unmount instead of losing them", async () => {
    const { unmount } = renderEditor();
    editText("hello world");
    expect(saveStatus()).toBe("dirty");

    // Unmount before the 900 ms debounce fires: the cleanup flushes.
    unmount();
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(patchBlocksText(0)).toBe("hello world");
  });
});
