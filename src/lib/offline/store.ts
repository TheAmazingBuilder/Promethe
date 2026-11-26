/**
 * Offline storage (§25.5) - IndexedDB store with an in-memory store for
 * tests. This is the testable seam: all queue logic operates on the
 * OfflineStore interface, so unit tests run in Node against MemoryStore
 * while the browser uses IndexedDB.
 *
 * The queue lives in IndexedDB, never in the service worker cache and
 * never in any HTTP cache. Reference snapshots share the same database
 * (separate object store). Everything is cleared on logout.
 */
import type { OfflineQueueItem } from "./types";

export interface OfflineStore {
  getItem(id: string): Promise<OfflineQueueItem | null>;
  putItem(item: OfflineQueueItem): Promise<void>;
  deleteItem(id: string): Promise<void>;
  listItems(userId: string): Promise<OfflineQueueItem[]>;
  clearUser(userId: string): Promise<void>;
  getReference(kind: string): Promise<unknown | null>;
  putReference(kind: string, value: unknown): Promise<void>;
  clearReferences(): Promise<void>;
}

const DB_NAME = "promethe-offline";
const DB_VERSION = 1;
const QUEUE_STORE = "queue";
const REFERENCE_STORE = "reference";

/** In-memory store: the Node/test implementation of OfflineStore. */
export class MemoryStore implements OfflineStore {
  private items = new Map<string, OfflineQueueItem>();
  private references = new Map<string, unknown>();

  async getItem(id: string): Promise<OfflineQueueItem | null> {
    return this.items.get(id) ?? null;
  }

  async putItem(item: OfflineQueueItem): Promise<void> {
    this.items.set(item.id, { ...item });
  }

  async deleteItem(id: string): Promise<void> {
    this.items.delete(id);
  }

  async listItems(userId: string): Promise<OfflineQueueItem[]> {
    return [...this.items.values()]
      .filter((item) => item.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async clearUser(userId: string): Promise<void> {
    for (const item of [...this.items.values()]) {
      if (item.userId === userId) this.items.delete(item.id);
    }
  }

  async getReference(kind: string): Promise<unknown | null> {
    return this.references.get(kind) ?? null;
  }

  async putReference(kind: string, value: unknown): Promise<void> {
    this.references.set(kind, value);
  }

  async clearReferences(): Promise<void> {
    this.references.clear();
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const queue = db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
        queue.createIndex("userId", "userId", { unique: false });
      }
      if (!db.objectStoreNames.contains(REFERENCE_STORE)) {
        db.createObjectStore(REFERENCE_STORE, { keyPath: "kind" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function withStore<T>(
  db: IDBDatabase,
  name: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const store = tx.objectStore(name);
    let result: Promise<T>;
    try {
      const out = run(store);
      result = out instanceof Promise ? out : requestToPromise(out);
    } catch (error) {
      reject(error);
      return;
    }
    result.then(resolve, reject);
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed."));
  });
}

/** Browser implementation of OfflineStore, backed by IndexedDB. */
export class IndexedDbStore implements OfflineStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openDb();
    return this.dbPromise;
  }

  async getItem(id: string): Promise<OfflineQueueItem | null> {
    const db = await this.db();
    const item = await withStore(db, QUEUE_STORE, "readonly", (store) =>
      store.get(id),
    );
    return (item as OfflineQueueItem | undefined) ?? null;
  }

  async putItem(item: OfflineQueueItem): Promise<void> {
    const db = await this.db();
    await withStore(db, QUEUE_STORE, "readwrite", (store) => store.put(item));
  }

  async deleteItem(id: string): Promise<void> {
    const db = await this.db();
    await withStore(db, QUEUE_STORE, "readwrite", (store) => store.delete(id));
  }

  async listItems(userId: string): Promise<OfflineQueueItem[]> {
    const db = await this.db();
    const items = await withStore(db, QUEUE_STORE, "readonly", (store) =>
      store.index("userId").getAll(userId),
    );
    return (items as OfflineQueueItem[]).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  async clearUser(userId: string): Promise<void> {
    const db = await this.db();
    const items = await this.listItems(userId);
    await withStore(db, QUEUE_STORE, "readwrite", async (store) => {
      for (const item of items) store.delete(item.id);
    });
  }

  async getReference(kind: string): Promise<unknown | null> {
    const db = await this.db();
    const row = await withStore(db, REFERENCE_STORE, "readonly", (store) =>
      store.get(kind),
    );
    const typed = row as { kind: string; value: unknown } | undefined;
    return typed ? typed.value : null;
  }

  async putReference(kind: string, value: unknown): Promise<void> {
    const db = await this.db();
    await withStore(db, REFERENCE_STORE, "readwrite", (store) =>
      store.put({ kind, value }),
    );
  }

  async clearReferences(): Promise<void> {
    const db = await this.db();
    await withStore(db, REFERENCE_STORE, "readwrite", (store) => store.clear());
  }
}

/** Browser singleton. Throws when IndexedDB is unavailable. */
let browserStore: IndexedDbStore | null = null;

export function getBrowserStore(): IndexedDbStore {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is unavailable, offline queue disabled.");
  }
  if (!browserStore) browserStore = new IndexedDbStore();
  return browserStore;
}

export function isOfflineQueueSupported(): boolean {
  return typeof indexedDB !== "undefined";
}
