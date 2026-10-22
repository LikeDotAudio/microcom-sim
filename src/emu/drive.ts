// Drive C: as an in-memory directory tree (the browser keeps it in IndexedDB; see store.ts).
// Names are matched case-insensitively and new ones are created in upper case, like the
// host-directory drive of mcomtui/dos.py.

export interface FileNode { kind: 'file'; data: Uint8Array; size: number; mtime: number }
export interface DirNode { kind: 'dir'; entries: Map<string, Node>; mtime: number }
export type Node = FileNode | DirNode;

export const newDir = (mtime = Date.now()): DirNode => ({ kind: 'dir', entries: new Map(), mtime });
export const newFile = (data: Uint8Array = new Uint8Array(0), mtime = Date.now()): FileNode =>
  ({ kind: 'file', data, size: data.length, mtime });

/** The bytes of a file (its buffer may be larger than its size). */
export const fileBytes = (f: FileNode) => f.data.subarray(0, f.size);

export class Drive {
  root: DirNode = newDir();
  cwd = '';                                  // DOS path below C:\, uppercase, no leading backslash
  onChange: () => void = () => {};
  now: () => number = () => Date.now();

  dosParts(path: string): string[] {
    path = path.replace(/\//g, '\\');
    if (path.length >= 2 && path[1] === ':') path = path.slice(2);
    let parts: string[];
    if (path.startsWith('\\')) { parts = []; path = path.slice(1); }
    else parts = this.cwd.split('\\').filter(Boolean);
    for (const p of path.split('\\')) {
      if (p === '' || p === '.') continue;
      if (p === '..') parts.pop();
      else parts.push(p.toUpperCase());
    }
    return parts;
  }

  /** The node at these parts; with create, a missing last part gives [parent, name] to create. */
  resolve(parts: string[]): Node | null {
    let node: Node = this.root;
    for (const part of parts) {
      if (node.kind !== 'dir') return null;
      const hit = this.find(node, part);
      if (!hit) return null;
      node = hit[1];
    }
    return node;
  }

  find(dir: DirNode, name: string): [string, Node] | null {
    for (const [n, node] of dir.entries) if (n.toUpperCase() === name.toUpperCase()) return [n, node];
    return null;
  }

  parentOf(parts: string[]): [DirNode, string] | null {
    const parent = this.resolve(parts.slice(0, -1));
    if (!parent || parent.kind !== 'dir' || !parts.length) return null;
    return [parent, parts[parts.length - 1]];
  }

  // ---- convenience for the page and tests --------------------------------------------------
  writeFile(path: string, data: Uint8Array, mtime = this.now()) {
    const parts = this.dosParts(path.startsWith('\\') ? path : '\\' + path);
    let dir = this.root;
    for (const p of parts.slice(0, -1)) {
      const hit = this.find(dir, p);
      if (hit && hit[1].kind === 'dir') dir = hit[1];
      else { const d = newDir(mtime); dir.entries.set(p, d); dir = d; }
    }
    const name = parts[parts.length - 1];
    const hit = this.find(dir, name);
    dir.entries.set(hit ? hit[0] : name, newFile(data.slice(), mtime));
    this.onChange();
  }

  readFile(path: string): Uint8Array | null {
    const n = this.resolve(this.dosParts(path.startsWith('\\') ? path : '\\' + path));
    return n && n.kind === 'file' ? fileBytes(n) : null;
  }

  remove(path: string) {
    const pp = this.parentOf(this.dosParts(path.startsWith('\\') ? path : '\\' + path));
    const hit = pp && this.find(pp[0], pp[1]);
    if (pp && hit) { pp[0].entries.delete(hit[0]); this.onChange(); }
  }

  /** Every file as [DOS path, node], for listings and saving. */
  list(dir: DirNode = this.root, prefix = ''): [string, FileNode][] {
    const out: [string, FileNode][] = [];
    for (const [name, node] of [...dir.entries].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const p = prefix ? `${prefix}\\${name}` : name;
      if (node.kind === 'file') out.push([p, node]);
      else out.push(...this.list(node, p));
    }
    return out;
  }
}
