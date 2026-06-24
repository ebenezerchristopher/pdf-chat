import { openDB, type IDBPDatabase } from "idb";

export type StoredDoc = {
  id: string;
  name: string;
  pageCount: number;
  chunks: string[];
  embeddings: number[][];
  createdAt: number;
};

const DB_NAME = "pdf-chat";
const DB_VERSION = 1;
const STORE = "documents";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (typeof window === "undefined") {
    throw new Error("IndexedDB is only available in the browser");
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveDoc(doc: StoredDoc): Promise<void> {
  const db = await getDb();
  await db.put(STORE, doc);
}

export async function getDoc(id: string): Promise<StoredDoc | undefined> {
  const db = await getDb();
  return db.get(STORE, id);
}

export async function listDocs(): Promise<StoredDoc[]> {
  const db = await getDb();
  return db.getAll(STORE);
}

export async function deleteDoc(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}

export async function getLatestDoc(): Promise<StoredDoc | undefined> {
  const all = await listDocs();
  if (all.length === 0) return undefined;
  all.sort((a, b) => b.createdAt - a.createdAt);
  return all[0];
}
