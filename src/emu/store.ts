// Keeps drive C: in this browser's IndexedDB, so the visitor's own MCOM.EXE and setup files
// survive a reload. Nothing leaves the browser.
import { type DirNode, Drive, type Node, newDir, newFile } from './drive';

interface Entry { path: string; dir: boolean; mtime: number; data?: ArrayBuffer }

const DB = 'mcom-emu', STORE = 'drive', KEY = 'C';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function flatten(dir: DirNode, prefix = ''): Entry[] {
  const out: Entry[] = [];
  for (const [name, node] of dir.entries) {
    const path = prefix ? `${prefix}\\${name}` : name;
    if (node.kind === 'dir') out.push({ path, dir: true, mtime: node.mtime }, ...flatten(node, path));
    else out.push({ path, dir: false, mtime: node.mtime, data: node.data.slice(0, node.size).buffer });
  }
  return out;
}

export async function loadDrive(): Promise<Drive | null> {
  try {
    const db = await open();
    const entries = await new Promise<Entry[] | undefined>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result as Entry[] | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!entries) return null;
    const drive = new Drive();
    for (const e of entries) {
      const parts = e.path.split('\\');
      let dir = drive.root;
      for (const p of parts.slice(0, -1)) {
        let next = dir.entries.get(p) as Node | undefined;
        if (!next || next.kind !== 'dir') { next = newDir(e.mtime); dir.entries.set(p, next); }
        dir = next;
      }
      const name = parts[parts.length - 1];
      if (e.dir) { if (!dir.entries.has(name)) dir.entries.set(name, newDir(e.mtime)); }
      else dir.entries.set(name, newFile(new Uint8Array(e.data ?? new ArrayBuffer(0)), e.mtime));
    }
    return drive;
  } catch {
    return null;                                 // storage unavailable (private window, blocked)
  }
}

export async function saveDrive(drive: Drive | null): Promise<boolean> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      if (drive) tx.objectStore(STORE).put(flatten(drive.root), KEY);
      else tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

/** Calls saveDrive at most every `ms` while the drive keeps changing. */
export function autosave(drive: Drive, ms = 600, onSaved: (ok: boolean) => void = () => {}) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  drive.onChange = () => {
    if (timer) return;
    timer = setTimeout(async () => { timer = null; onSaved(await saveDrive(drive)); }, ms);
  };
}
