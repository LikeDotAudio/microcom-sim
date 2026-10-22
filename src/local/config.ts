// Per-facility MicroCOM II configuration, decoded from serial uploads (spec 05 §6) or MCOM files
// (spec 01-04). Port of mcommatrix/config.py.

export const MAXBUS = 240;
export const EMPTY = 0xff;

/** terminal type -> [keys A, key offset K, blocks B, name] (spec 05 §6.10 and spec 02) */
export const TERMINALS: Record<string, [number, number, number, string]> = {
  '0': [40, 6, 1, ''], '1': [10, 6, 1, 'M7880'], '2': [20, 6, 2, 'M7880/81'],
  '3': [6, 2, 1, 'M7880B'], '4': [16, 12, 2, 'M7880D'], '5': [36, 6, 4, 'M7880/F'],
  '6': [36, 12, 4, 'M7880D/F'], '7': [10, 6, 1, 'M7882/83'], '8': [12, 8, 1, 'M7884/85'],
  '9': [6, 2, 1, 'M7840'],
};
const AD = ['A', 'B', 'C', 'D'];
const nums = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
/** slot -> physical key label per terminal type (spec 04 §2.2) */
export const KEY_LABELS: Record<string, string[]> = {
  '1': [...nums(1, 6), ...AD],
  '7': [...nums(1, 6), ...AD],
  '2': [...nums(1, 6), ...AD, ...nums(7, 16)],
  '3': ['1', '2', ...AD],
  '9': ['#0', '#9', '#1', '#2', '#3', '#4'],
  '4': [...nums(1, 12), ...AD],
  '8': [...nums(1, 8), ...AD],
  '5': [...nums(1, 6), ...AD, ...Array(10).fill(''), ...nums(1, 16).map(i => `2:${i}`)],
  '6': [...nums(1, 12), ...AD, ...Array(4).fill(''), ...nums(1, 16).map(i => `2:${i}`)],
  '0': nums(1, 40),
};
/** phantom families: attr byte -> [prefix, digits, name-table offset] */
export const PHANTOMS: Record<number, [string, number, number]> = {
  0xc1: ['GRP', 1, 0], 0xc4: ['CA', 2, 4], 0xc3: ['CMA', 1, 16], 0xc5: ['CNF', 1, 24],
  0xc6: ['EV', 2, 32], 0xcb: ['IS', 2, 56],
};

export function phantomName(attr: number, code: number): string | null {
  const fam = PHANTOMS[attr];
  return fam ? `${fam[0]}${String(code).padStart(fam[1], '0')}` : null;
}

/** Wire/file 'empty' is 0 or 0xFF -> 0. */
const z = (b: number) => (b === 0 || b === EMPTY ? 0 : b);
export const latin1 = (d: ArrayLike<number>) => String.fromCharCode(...Array.from(d));
const txt = (d: ArrayLike<number>) => latin1(Array.from(d, b => (b === 0 ? 0x2e : b)));
export const hex = (d: ArrayLike<number>) => Array.from(d, b => b.toString(16).padStart(2, '0')).join('');
const fromHex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], h => parseInt(h, 16));
const any = (d: ArrayLike<number>) => Array.from(d).some(b => b !== 0);
const rstrip = (s: string, chars = ' \t\n\r\x0b\x0c') => { let e = s.length; while (e > 0 && chars.includes(s[e - 1])) e--; return s.slice(0, e); };
const isDigits = (s: string) => /^\d+$/.test(s);
/** Python int(bytes): optional surrounding whitespace around decimal digits. */
const pyInt = (s: string) => { const t = s.trim(); if (!/^[+-]?\d+$/.test(t)) throw new Error(`invalid literal for int(): ${JSON.stringify(s)}`); return parseInt(t, 10); };

export interface EpcItem { in: number; out: number; type: number; ext: number; comment: string }
export type Pending = Map<string, unknown>;

export interface FacilityJson {
  size: number; mnemonic: Record<string, string>; attr: Record<string, number>; term: Record<string, string>;
  desc: Record<string, string>; overlay: Record<string, string>; keypad: string[]; phantom: string[];
  relay_out: number[]; relay_mask: string[]; ifb_bus: number[]; ifb_pgm: number[]; ifb_mode: number;
  pgm_limit: number; cam: number[]; cam_flags: number[]; iso: number[]; call: number[][]; epc: EpcItem[];
  keys: Record<string, number[][]>; groups: Record<string, number[]>;
}

export const FIELDS = ['size', 'mnemonic', 'attr', 'term', 'desc', 'overlay', 'keypad', 'phantom', 'relay_out',
  'relay_mask', 'ifb_bus', 'ifb_pgm', 'ifb_mode', 'pgm_limit', 'cam', 'cam_flags', 'iso', 'call', 'epc',
  'keys', 'groups'] as const;
const MAPS = ['mnemonic', 'attr', 'term', 'desc', 'overlay', 'keys', 'groups'] as const;

export interface McomFiles { mtx: Uint8Array; ova?: Uint8Array; tma?: Uint8Array; epc?: Uint8Array }

export class FacilityConfig {
  size = 0;
  mnemonic: Record<number, string> = {};
  attr: Record<number, number> = {};
  term: Record<number, string> = {};
  desc: Record<number, string> = {};
  overlay: Record<number, string> = {};
  keypad: string[] = Array(18).fill('....');
  phantom: string[] = Array(60).fill('');
  relay_out: number[] = Array(12).fill(0);
  relay_mask: string[] = Array(12).fill('ff'.repeat(30));
  ifb_bus: number[] = Array(48).fill(0);
  ifb_pgm: number[] = Array(48).fill(0);
  ifb_mode = 0;
  pgm_limit = 0;
  cam: number[] = Array(96).fill(0);
  cam_flags: number[] = Array(8).fill(0);
  iso: number[] = Array(24).fill(0);
  call: number[][] = Array.from({ length: 12 }, () => Array(24).fill(0));
  epc: EpcItem[] = [];
  keys: Record<number, number[][]> = {};
  groups: Record<number, number[]> = {};

  // ---- persistence -------------------------------------------------------------
  toJson(): FacilityJson {
    return JSON.parse(JSON.stringify(Object.fromEntries(FIELDS.map(k => [k, this[k]])))) as FacilityJson;
  }

  static fromJson(d: Partial<FacilityJson>): FacilityConfig {
    const c = new FacilityConfig();
    const o = c as unknown as Record<string, unknown>;
    for (const k of FIELDS) if (k in d) o[k] = JSON.parse(JSON.stringify((d as Record<string, unknown>)[k]));
    for (const m of MAPS) o[m] = { ...(o[m] as object) };
    return c;
  }

  // ---- helpers -------------------------------------------------------------------
  keyset(bus: number): number[][] {
    return (this.keys[bus] ??= Array.from({ length: 40 }, () => [0, 0]));
  }

  maskBit(relay: number, bus: number): boolean {
    if (!(bus >= 1 && bus <= 240)) return false;
    const m = fromHex(this.relay_mask[relay]);
    return !!(((m[(bus - 1) >> 3] ?? 0) >> ((bus - 1) & 7)) & 1);
  }

  /** IFB number from an 'IFnn' mnemonic (spec 03), else 0. */
  ifbNumberOf(bus: number): number {
    const mn = this.mnemonic[bus] ?? '';
    const d = mn.slice(2, 4).trim();
    if (mn.slice(0, 2).toUpperCase() === 'IF' && isDigits(d)) {
      const n = parseInt(d, 10);
      return n >= 1 && n <= 48 ? n : 0;
    }
    return 0;
  }

  // ---- serial upload decoding (spec 05 §6) ------------------------------------------
  /** Apply one validated block. Returns a short description for the log (null = partial). */
  applyBlock(typ: number, blk: number, d: Uint8Array, pending: Pending): string | null {
    if (typ === 0x0f) {                                      // index: 6 x (mnemonic4, attr)
      for (let j = 0; j < 6; j++) {
        const bus = (blk - 1) * 6 + j + 1;
        const rec = d.subarray(j * 5, j * 5 + 5);
        if (any(rec) && bus <= MAXBUS) {
          this.mnemonic[bus] = latin1(rec.subarray(0, 4));
          this.attr[bus] = rec[4];
          this.size = Math.max(this.size, bus);
        }
      }
      return `index buses ${(blk - 1) * 6 + 1}-${blk * 6}`;
    }
    if (typ === 0x0a) {                                      // keypad prefix codes
      for (let j = 0; j < 6; j++) {
        const k = (blk - 1) * 6 + j;
        if (k >= 0 && k < 18) this.keypad[k] = txt(d.subarray(j * 4, j * 4 + 4));
      }
      return `keypad codes block ${blk}`;
    }
    if (typ === 0x0d) {
      if (blk >= 0x31 && blk <= 0x3a) {                      // phantom overlay
        for (let j = 0; j < 6; j++) {
          const i = (blk - 0x31) * 6 + j;
          if (i < 60) this.phantom[i] = rstrip(latin1(d.subarray(j * 5, j * 5 + 4)), '\0');
        }
        return `phantom overlay block ${blk - 0x30}`;
      }
      for (let j = 0; j < 6; j++) {                          // index overlay
        const bus = (blk - 1) * 6 + j + 1;
        const t = d.subarray(j * 5, j * 5 + 4);
        if (any(t) && bus <= MAXBUS) this.overlay[bus] = latin1(t);
      }
      return `overlay buses ${(blk - 1) * 6 + 1}-${blk * 6}`;
    }
    if (typ === 0x50) {                                      // relays
      if (blk === 1) {
        this.relay_out = Array.from(d.subarray(0, 12), z);
        return 'relay output map';
      }
      const r = blk - 2;
      if (r >= 0 && r < 12) this.relay_mask[r] = hex(d);
      return `relay ${r + 1} input mask`;
    }
    if (typ === 0xa6) {                                      // IFB / program sound
      for (let j = 0; j < 12; j++) {
        const i = (blk - 1) * 12 + j;
        if (i >= 0 && i < 48) { this.ifb_bus[i] = d[2 * j]; this.ifb_pgm[i] = d[2 * j + 1]; }
      }
      this.ifb_mode = d[28];
      this.pgm_limit = d[29];
      return `IFB block ${blk}/${d[27]} (mode ${d[28]}, PGM limit ${d[29]})`;
    }
    if (typ === 0xa5) {                                      // camera arrays + ISO
      if (blk === 5) {
        this.iso = Array.from(d.subarray(0, 24));
        return 'ISO assignments';
      }
      const c = (blk - 1) * 24;
      const g = 2 * (blk - 1);
      if (g >= 0 && g < 8) {
        this.cam.splice(c, 12, ...d.subarray(0, 12));
        this.cam_flags[g] = d[12];
        this.cam.splice(c + 12, 12, ...d.subarray(13, 25));
        this.cam_flags[g + 1] = d[25];
      }
      return `camera arrays ${g + 1}-${g + 2}`;
    }
    if (typ === 0xa9) {                                      // call arrays
      if (blk >= 1 && blk <= 12) this.call[blk - 1] = Array.from(d.subarray(0, 24));
      return `call array CA${String(blk).padStart(2, '0')}`;
    }
    if (typ === 0xa0) {                                      // EPC (bytes 2/3 swapped on the wire)
      const nb = d[28], n = d[29];
      let items = pending.get('epc') as EpcItem[] | undefined;
      if (!items) pending.set('epc', items = []);
      for (let j = 0; j < 6; j++) {
        const e = d.subarray(4 * j, 4 * j + 4);
        items.push({ in: e[0], out: e[1], type: e[3], ext: e[2], comment: '' });
      }
      if (blk >= nb) {
        this.epc = items.slice(0, Math.max(n - 1, 0)).filter(x => x.in);
        pending.delete('epc');
        return this.epc.length ? `EPC table (${this.epc.length} entries)` : 'EPC off';
      }
      return null;
    }
    if (typ === 0xf0) return this.terminalBlock(blk, d, pending);
    return `unknown block type ${typ.toString(16).toUpperCase().padStart(2, '0')}`;
  }

  private terminalBlock(blk: number, d: Uint8Array, pending: Pending): string | null {
    const bus = d[0];
    if (blk === 5) {                                         // group upload
      this.groups[bus] = Array.from(d.subarray(1, 25));
      return `groups for bus ${String(bus).padStart(3, '0')}`;
    }
    const key = `term:${bus}`;
    let st = pending.get(key) as Map<number, Uint8Array> | undefined;
    if (!st) pending.set(key, st = new Map());
    st.set(blk, Uint8Array.from(d));
    const first = st.get(1);
    if (!first) return null;
    const nblocks = first[27];
    for (let b = 1; b <= nblocks; b++) if (!st.has(b)) return null;
    pending.delete(key);
    const ttype = this.inferTerminal(bus, first[29], nblocks, st);
    const [, k, , name] = TERMINALS[ttype];
    const pairs = Array.from({ length: 40 }, () => [0, 0]);
    const put = (slots: number[], data: Uint8Array) => slots.forEach((s, i) => { pairs[s] = [data[2 * i], data[2 * i + 1]]; });
    const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
    const order = [...range(k, k + 4), ...(k < 8 ? [...range(0, k), ...range(k + 4, 12)] : range(0, 8))];
    put(order, first.subarray(1, 25));
    if (nblocks > 1) {
      const b2 = st.get(2)!;
      if (k === 12) put(range(8, 12), b2.subarray(1, 9));
      else put(range(12, 20), b2.subarray(1, 17));
    }
    if (nblocks === 4) {
      put(range(32, 36), st.get(3)!.subarray(1, 9));
      put(range(20, 28), st.get(3)!.subarray(9, 25));
      put(range(28, 32), st.get(4)!.subarray(1, 9));
    }
    this.keys[bus] = pairs;
    if (!(bus in this.term)) this.term[bus] = ttype;
    return `terminal ${String(bus).padStart(3, '0')} keys (${name || 'type ' + ttype})`;
  }

  private inferTerminal(bus: number, nkeys: number, nblocks: number, st: Map<number, Uint8Array>): string {
    const known = this.term[bus];
    if (known in TERMINALS && TERMINALS[known][0] === nkeys && TERMINALS[known][2] === nblocks) return known;
    if (nkeys === 36 && nblocks === 4) {                     // '5' and '6' differ only in block 2's layout
      const b2 = st.get(2) ?? new Uint8Array(30);
      return any(b2.subarray(9, 17)) || !any(b2.subarray(1, 9)) ? '5' : '6';
    }
    for (const t of ['1', '2', '3', '4', '8', '0', '7', '9']) {
      const [a, , b] = TERMINALS[t];
      if (a === nkeys && b === nblocks) return t;
    }
    return '0';
  }

  // ---- import of MCOM setup files (spec 01) -----------------------------------------
  static fromMcomFiles(files: McomFiles): FacilityConfig {
    const c = new FacilityConfig();
    const mtx = files.mtx;
    const n = pyInt(latin1(mtx.subarray(0x1d, 0x20)));
    c.size = n;
    for (let k = 0; k < 18; k++) c.keypad[k] = latin1(mtx.subarray(0x22 + k * 4, 0x26 + k * 4));
    for (let b = 1; b <= n; b++) {
      const r = mtx.subarray(0x6c + (b - 1) * 28, 0x6c + b * 28);
      c.mnemonic[b] = latin1(r.subarray(0, 4));
      c.attr[b] = r[4];
      const t = String.fromCharCode(r[5]);
      c.term[b] = t in TERMINALS ? t : '0';
      c.desc[b] = rstrip(latin1(r.subarray(6, 28)));
    }
    const o = n * 28;
    for (let r = 0; r < 12; r++) {
      const rec = mtx.subarray(o + 0x70 + r * 31, o + 0x70 + (r + 1) * 31);
      c.relay_out[r] = z(rec[0]);
      c.relay_mask[r] = hex(rec.subarray(1, 31));
    }
    for (let a = 0; a < 12; a++) c.call[a] = Array.from(mtx.subarray(o + 0x1e8 + a * 24, o + 0x1e8 + (a + 1) * 24), z);
    const cam = mtx.subarray(o + 0x30c, o + 0x30c + 24 + 8 * 13);
    c.iso = Array.from(cam.subarray(0, 24), z);
    for (let a = 0; a < 8; a++) {
      const g = cam.subarray(24 + a * 13, 24 + (a + 1) * 13);
      c.cam_flags[a] = g[0] === EMPTY ? 0 : g[0];
      c.cam.splice(a * 12, 12, ...Array.from(g.subarray(1, 13), z));
    }
    const ifb = mtx.subarray(o + 0x390, o + 0x390 + 52);
    const m0 = String.fromCharCode(ifb[0]);
    c.ifb_mode = /^\d$/.test(m0) ? parseInt(m0, 10) : 0;
    const pl = latin1(ifb.subarray(1, 4));
    c.pgm_limit = isDigits(pl) ? parseInt(pl, 10) : 0;
    c.ifb_pgm = Array.from(ifb.subarray(4, 52), z);
    for (let b = 1; b <= n; b++) {
      const i = c.ifbNumberOf(b);
      if (i) c.ifb_bus[i - 1] = b;
    }
    if (files.ova) {
      const d = files.ova;
      for (let i = 0; i < 56; i++) c.phantom[i] = latin1(d.subarray(0x26 + i * 4, 0x2a + i * 4));
      for (let b = 1; b <= n; b++) {
        const t = latin1(d.subarray(0x107 + (b - 1) * 4, 0x10b + (b - 1) * 4));
        if (t.trim()) c.overlay[b] = t;
      }
    }
    if (files.tma) {
      const d = files.tma;
      for (let b = 1; b <= n; b++) {
        const rec = d.subarray(0x26 + (b - 1) * 105, 0x26 + b * 105);
        if (rec.length < 105) break;
        c.keys[b] = Array.from({ length: 40 }, (_, s) => [z(rec[1 + 2 * s]), z(rec[2 + 2 * s])]);
        c.groups[b] = Array.from(rec.subarray(81, 105), z);
      }
    }
    if (files.epc) {
      const d = files.epc;
      let p = 0x26;
      while (p + 20 <= d.length && d[p] !== 0 && d[p] !== EMPTY) {
        c.epc.push({ in: d[p], out: d[p + 1], type: d[p + 2], ext: d[p + 3], comment: rstrip(latin1(d.subarray(p + 4, p + 20))) });
        p += 20;
      }
    }
    return c;
  }
}
