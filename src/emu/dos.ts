// INT 21h: the subset of MS-DOS that MCOM.EXE uses, on the in-memory drive C:
// (port of mcomtui/dos.py).
import { CF, ZF } from './cpu';
import type { Printer } from './bios';
import { Drive, type FileNode, newDir, newFile } from './drive';
import { Exit, type Machine, PSP_SEG, TOP_SEG } from './machine';

const E_NOFUNC = 1, E_NOFILE = 2, E_NOPATH = 3, E_ACCESS = 5, E_BADHANDLE = 6, E_NOMEM = 8, E_NOMORE = 18;

interface Handle { file: FileNode; pos: number }
type Open = Handle | 'printer';

const latin1 = (b: Uint8Array) => Array.from(b, c => String.fromCharCode(c)).join('');
const bytes = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0) & 0xFF);

/** DOS packed time and date for a host timestamp (ms), in local time. */
export function dosTime(ms: number): [number, number] {
  const t = new Date(ms);
  const date = ((Math.max(t.getFullYear(), 1980) - 1980) << 9) | ((t.getMonth() + 1) << 5) | t.getDate();
  const time = (t.getHours() << 11) | (t.getMinutes() << 5) | Math.floor(t.getSeconds() / 2);
  return [time, date];
}

/** fnmatch-style match of one name part ('*', '?'). */
function globMatch(pat: string, name: string): boolean {
  const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 's');
  return re.test(name);
}

/** DOS wildcard match on 8.3 names ('*.*' matches names without a dot too). */
export function dosMatch(pattern: string, name: string): boolean {
  const up = pattern.toUpperCase();
  const dot = up.indexOf('.');
  const pb = dot < 0 ? up : up.slice(0, dot), pe = dot < 0 ? '' : up.slice(dot + 1);
  const nd = name.indexOf('.');
  const nb = nd < 0 ? name : name.slice(0, nd), ne = nd < 0 ? '' : name.slice(nd + 1);
  return globMatch(pb || '*', nb) && (pattern.includes('.') ? globMatch(pe, ne) : ne === '' || pb.endsWith('*'));
}

export class Dos {
  private readonly files = new Map<number, Open>();
  private dta: [number, number] = [PSP_SEG, 0x80];
  private readonly findState = new Map<string, [string, import('./drive').Node][]>();
  private readonly blocks = new Map<number, number>();     // seg -> paragraphs
  private programBlock: [number, number] = [PSP_SEG, TOP_SEG - PSP_SEG];
  private lastError = 0;
  trace = false;

  constructor(readonly m: Machine, readonly fs: Drive, readonly log: (s: string) => void,
              readonly printer: Printer, readonly shell: () => void) {
    m.intHandlers.set(0x21, () => this.int21());
    m.intHandlers.set(0x20, () => { throw new Exit(0); });
  }

  private ok(ax?: number) {
    if (ax !== undefined) this.m.set({ ax });
    this.m.setFlag(CF, false);
  }
  private err(code: number) {
    this.lastError = code;
    this.m.set({ ax: code });
    this.m.setFlag(CF, true);
  }
  private pathArg(seg = this.m.ds, off = this.m.dx): string { return latin1(this.m.asciiz(seg, off)); }
  private newHandle(f: Open): number {
    let h = 5;
    while (this.files.has(h)) h++;
    this.files.set(h, f);
    return h;
  }
  private changed() { this.fs.onChange(); }

  // ---- memory -----------------------------------------------------------------------------------
  private used(): [number, number][] {
    return [this.programBlock, ...this.blocks.entries()].sort((a, b) => a[0] - b[0]);
  }
  private alloc(paras: number): [number, number] {
    const used = this.used();
    let largest = 0;
    for (let i = 0; i < used.length; i++) {
      const [seg, size] = used[i];
      const gapStart = seg + size + 1;
      const gapEnd = i + 1 < used.length ? used[i + 1][0] - 1 : TOP_SEG;
      const gap = gapEnd - gapStart;
      if (gap >= paras) { this.blocks.set(gapStart, paras); return [gapStart, gap]; }
      largest = Math.max(largest, gap);
    }
    return [0, Math.max(largest, 0)];
  }
  private resize(seg: number, paras: number): [boolean, number] {
    const limitAbove = (cands: number[]) => {
      const others = cands.filter(s => s > seg);
      return (others.length ? Math.min(...others) - 1 : TOP_SEG) - seg;
    };
    if (seg === this.programBlock[0]) {
      const limit = limitAbove([...this.blocks.keys()]);
      if (paras <= limit) { this.programBlock = [seg, paras]; return [true, paras]; }
      return [false, limit];
    }
    if (this.blocks.has(seg)) {
      const limit = limitAbove([...this.blocks.keys(), this.programBlock[0]]);
      if (paras <= limit) { this.blocks.set(seg, paras); return [true, paras]; }
      return [false, limit];
    }
    return [false, 0];
  }

  // ---- dispatcher ---------------------------------------------------------------------------------
  int21() {
    const m = this.m, ah = m.get8('ah');
    if (this.trace) this.log(`DOS AX=${m.ax.toString(16)} BX=${m.bx.toString(16)} CX=${m.cx.toString(16)} DX=${m.dx.toString(16)}`);
    const fn = (this as unknown as Record<string, (() => void) | undefined>)[`f${ah.toString(16).padStart(2, '0')}`];
    if (!fn) {
      this.log(`DOS: unimplemented AH=${ah.toString(16)} AX=${m.ax.toString(16)} at ${m.cs.toString(16)}:${m.ip.toString(16)}`);
      this.err(E_NOFUNC);
      return;
    }
    fn.call(this);
  }

  f02() {}
  f06() { this.m.setFlag(ZF, true); this.m.set8('al', 0); }
  f09() {
    const s = this.m.read(this.m.ds * 16 + this.m.dx, 512);
    const end = s.indexOf(0x24);
    this.log(`DOS print: ${latin1(end < 0 ? s : s.slice(0, end))}`);
  }
  f0e() { this.m.set8('al', 3); }
  f19() { this.m.set8('al', 2); }
  f1a() { this.dta = [this.m.ds, this.m.dx]; }
  f2f() { this.m.set({ es: this.dta[0], bx: this.dta[1] }); }
  f25() { const n = this.m.get8('al'); this.m.w16(n * 4, this.m.dx); this.m.w16(n * 4 + 2, this.m.ds); }
  f35() { const [seg, off] = this.m.vector(this.m.get8('al')); this.m.set({ es: seg, bx: off }); }
  f2a() {
    const t = this.m.clock.wall();
    this.m.set({ cx: t.getFullYear(), dx: ((t.getMonth() + 1) << 8) | t.getDate() });
    this.m.set8('al', t.getDay());
  }
  f2c() {
    const t = this.m.clock.wall();
    this.m.set({ cx: (t.getHours() << 8) | t.getMinutes(), dx: (t.getSeconds() << 8) | Math.floor(t.getMilliseconds() / 10) });
  }
  f2b() { this.m.set8('al', 0); }
  f2d() { this.m.set8('al', 0); }
  f30() { this.m.set({ ax: 0x0005, bx: 0, cx: 0 }); }
  f33() { this.m.set8('dl', 0); }
  f36() { this.m.set({ ax: 64, bx: 0x7FFF, cx: 512, dx: 0xFFFF }); }

  f3b() {
    const parts = this.fs.dosParts(this.pathArg());
    const n = this.fs.resolve(parts);
    if (n && n.kind === 'dir') { this.fs.cwd = parts.join('\\'); this.ok(); } else this.err(E_NOPATH);
  }
  f39() {
    const pp = this.fs.parentOf(this.fs.dosParts(this.pathArg()));
    if (!pp || this.fs.find(pp[0], pp[1])) return this.err(E_ACCESS);
    pp[0].entries.set(pp[1].toUpperCase(), newDir(this.fs.now()));
    this.changed();
    this.ok();
  }
  f3a() {
    const pp = this.fs.parentOf(this.fs.dosParts(this.pathArg()));
    const hit = pp && this.fs.find(pp[0], pp[1]);
    if (!pp || !hit || hit[1].kind !== 'dir' || hit[1].entries.size) return this.err(E_NOPATH);
    pp[0].entries.delete(hit[0]);
    this.changed();
    this.ok();
  }
  f47() {
    const m = this.m;
    m.write(m.ds * 16 + m.si, [...bytes(this.fs.cwd), 0]);
    this.ok(0x0100);
  }

  f3c(exclusive = false) {
    const pp = this.fs.parentOf(this.fs.dosParts(this.pathArg()));
    if (!pp) return this.err(E_NOPATH);
    const hit = this.fs.find(pp[0], pp[1]);
    if (exclusive && hit) return this.err(80);
    if (hit && hit[1].kind === 'dir') return this.err(E_ACCESS);
    const f = newFile(new Uint8Array(0), this.fs.now());
    pp[0].entries.set(hit ? hit[0] : pp[1].toUpperCase(), f);
    this.changed();
    this.ok(this.newHandle({ file: f, pos: 0 }));
  }
  f5b() { this.f3c(true); }

  f3d() {
    const path = this.pathArg();
    if (['PRN', 'LPT1', 'PRN:', 'LPT1:'].includes(path.toUpperCase())) return this.ok(this.newHandle('printer'));
    const n = this.fs.resolve(this.fs.dosParts(path));
    if (!n || n.kind !== 'file') return this.err(E_NOFILE);
    this.ok(this.newHandle({ file: n, pos: 0 }));
  }
  f3e() {
    const h = this.m.bx;
    const f = this.files.get(h);
    this.files.delete(h);
    if (f === undefined && h > 4) return this.err(E_BADHANDLE);
    this.ok();
  }
  f3f() {
    const m = this.m, h = m.bx, n = m.cx;
    const f = this.files.get(h);
    if (f === undefined) return h === 0 || h === 3 ? this.ok(0) : this.err(E_BADHANDLE);
    if (f === 'printer') return this.ok(0);
    const data = f.file.data.subarray(f.pos, Math.min(f.file.size, f.pos + n));
    m.write(m.ds * 16 + m.dx, data);
    f.pos += data.length;
    this.ok(data.length);
  }
  f40() {
    const m = this.m, h = m.bx, n = m.cx;
    const data = m.read(m.ds * 16 + m.dx, n);
    if (h === 1 || h === 2) {
      const s = latin1(data);
      if (s.trim()) this.log(`stdout: ${s}`);
      return this.ok(n);
    }
    if (h === 4) { this.printer.write(data); return this.ok(n); }
    const f = this.files.get(h);
    if (f === undefined) return this.err(E_BADHANDLE);
    if (f === 'printer') { this.printer.write(data); return this.ok(n); }
    const file = f.file;
    if (n === 0) file.size = f.pos;                        // truncate at the file pointer
    else {
      const end = f.pos + n;
      if (end > file.data.length) {
        const grown = new Uint8Array(Math.max(end, file.data.length * 2, 64));
        grown.set(file.data.subarray(0, file.size));
        file.data = grown;
      }
      if (f.pos > file.size) file.data.fill(0, file.size, f.pos);
      file.data.set(data, f.pos);
      f.pos = end;
      file.size = Math.max(file.size, end);
    }
    file.mtime = this.fs.now();
    this.changed();
    this.ok(n);
  }
  f41() {
    const pp = this.fs.parentOf(this.fs.dosParts(this.pathArg()));
    const hit = pp && this.fs.find(pp[0], pp[1]);
    if (!pp || !hit || hit[1].kind !== 'file') return this.err(E_NOFILE);
    pp[0].entries.delete(hit[0]);
    this.changed();
    this.ok();
  }
  f42() {
    const m = this.m;
    const f = this.files.get(m.bx);
    if (f === undefined) return this.err(E_BADHANDLE);
    let off = m.cx * 0x10000 + m.dx;
    if (off >= 0x80000000) off -= 0x100000000;
    const whence = m.get8('al');
    let pos = 0;
    if (f !== 'printer') {
      pos = Math.max(0, (whence === 0 ? 0 : whence === 1 ? f.pos : f.file.size) + off);
      f.pos = pos;
    }
    m.set({ dx: Math.floor(pos / 0x10000), ax: pos & 0xFFFF });
    m.setFlag(CF, false);
  }
  f43() {
    const n = this.fs.resolve(this.fs.dosParts(this.pathArg()));
    if (!n) return this.err(E_NOFILE);
    this.m.set({ cx: n.kind === 'dir' ? 0x10 : 0x20 });
    this.ok(this.m.ax);
  }
  f44() {
    const m = this.m, al = m.get8('al'), h = m.bx;
    if (al === 0) {
      let info = ({ 0: 0x80D3, 1: 0x80D3, 2: 0x80D3, 3: 0x80C0, 4: 0xA0C0 } as Record<number, number>)[h];
      if (info === undefined) {
        if (!this.files.has(h)) return this.err(E_BADHANDLE);
        info = this.files.get(h) === 'printer' ? 0x80A0 : 0x0002;
      }
      m.set({ dx: info });
      return this.ok(info);
    }
    if (al === 6 || al === 7) { m.set8('al', 0xFF); return this.ok(m.ax); }
    if (al === 8) return this.ok(1);
    this.ok(0);
  }
  f45() {
    const f = this.files.get(this.m.bx);
    if (f === undefined) return this.err(E_BADHANDLE);
    this.ok(this.newHandle(f));
  }
  f48() {
    const [seg, largest] = this.alloc(this.m.bx);
    if (seg) this.ok(seg);
    else { this.m.set({ bx: largest }); this.err(E_NOMEM); }
  }
  f49() { this.blocks.delete(this.m.es); this.ok(); }
  f4a() {
    const [good, avail] = this.resize(this.m.es, this.m.bx);
    if (good) this.ok();
    else { this.m.set({ bx: avail }); this.err(E_NOMEM); }
  }
  f4b() { this.shell(); this.ok(0); }
  f4d() { this.ok(0); }
  f4c() { throw new Exit(this.m.get8('al')); }

  f4e() {
    const m = this.m, attrs = m.cx;
    const parts = this.fs.dosParts(this.pathArg());
    const pattern = parts.length ? parts[parts.length - 1] : '*.*';
    const dir = this.fs.resolve(parts.slice(0, -1));
    const results: [string, import('./drive').Node][] = [];
    if (dir && dir.kind === 'dir') {
      for (const name of [...dir.entries.keys()].sort()) {
        const up = name.toUpperCase();
        if (up.length > 12 || up.startsWith('.')) continue;
        const node = dir.entries.get(name)!;
        if (node.kind === 'dir' && !(attrs & 0x10)) continue;
        if (dosMatch(pattern, up)) results.push([up, node]);
      }
    }
    this.findState.set(this.dta.join(':'), results);
    this.findNext();
  }
  f4f() { this.findNext(); }
  private findNext() {
    const m = this.m;
    const results = this.findState.get(this.dta.join(':')) ?? [];
    const next = results.shift();
    if (!next) return this.err(E_NOMORE);
    const [name, node] = next;
    const [t, d] = dosTime(node.mtime);
    const rec = new Uint8Array(43);
    const dv = new DataView(rec.buffer);
    rec[0x15] = node.kind === 'dir' ? 0x10 : 0x20;
    dv.setUint16(0x16, t, true);
    dv.setUint16(0x18, d, true);
    dv.setUint32(0x1A, node.kind === 'dir' ? 0 : node.size, true);
    rec.set([...bytes(name), 0], 0x1E);
    m.write(this.dta[0] * 16 + this.dta[1], rec);
    this.ok(0);
  }
  f56() {
    const m = this.m;
    const src = this.fs.parentOf(this.fs.dosParts(this.pathArg()));
    const dst = this.fs.parentOf(this.fs.dosParts(latin1(m.asciiz(m.es, m.di))));
    const hit = src && this.fs.find(src[0], src[1]);
    if (!src || !dst || !hit) return this.err(E_ACCESS);
    const old = this.fs.find(dst[0], dst[1]);               // like os.rename: replaces a file
    src[0].entries.delete(hit[0]);
    if (old) dst[0].entries.delete(old[0]);
    dst[0].entries.set(old ? old[0] : dst[1].toUpperCase(), hit[1]);
    this.changed();
    this.ok();
  }
  f57() {
    const f = this.files.get(this.m.bx);
    if (f === undefined) return this.err(E_BADHANDLE);
    if (this.m.get8('al') === 0) {
      const [t, d] = f === 'printer' ? [0, 0] : dosTime(f.file.mtime);
      this.m.set({ cx: t, dx: d });
    }
    this.ok();
  }
  f59() { this.m.set({ ax: this.lastError, bx: 0x0101, cx: 0 }); }
  f62() { this.m.set({ bx: PSP_SEG }); }
  f51() { this.m.set({ bx: PSP_SEG }); }
}

export { Drive };
