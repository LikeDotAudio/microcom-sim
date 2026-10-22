// Engine persistence in IndexedDB (key/value): the engine state (as state.json in Python) and the
// panel-link secret. Every call is guarded: private windows or blocked storage just mean no persistence.

const DB = 'mcom-engine', STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

let db: Promise<IDBDatabase> | null = null;
const getDb = () => (db ??= open());

export async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const d = await getDb();
    return await new Promise<T | null>((res, rej) => {
      const r = d.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => res((r.result as T) ?? null);
      r.onerror = () => rej(r.error);
    });
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    const d = await getDb();
    await new Promise<void>((res, rej) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch { /* no persistence */ }
}

export async function kvDelete(key: string): Promise<void> {
  try {
    const d = await getDb();
    await new Promise<void>(res => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch { /* ignore */ }
}
