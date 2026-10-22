// MicroCOM III working data. MCOM II edited setup files on disk and uploaded them with Data Transfer;
// MicroCOM III edits a working copy of one production's engine configuration (getcfg) plus its
// matrix-level extras (extended keys, panel models). F10 in an editor saves into the working copy;
// Data Transfer ("Apply to Matrix") sends the changes with setcfg / extkeys / panelmodel.
import type { Cfg, EngineClient, ExtKey } from './engine';

export const TERM_NAMES = ['', 'M7880', 'M7880/81', 'M7880B', 'M7880D', 'M7880/F', 'M7880D/F', 'M7882/83', 'M7884/85', 'M7840'];
export const PANEL_MODELS: Record<string, number> = { M7832: 32, M7864: 64, M2026: 32, M2026P: 32 };
export const MODEL_NAMES = Object.keys(PANEL_MODELS);

const AD = ['A', 'B', 'C', 'D'];
const nums = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
/** slot -> physical key label per terminal type (spec 04 §2.2); '' = unused slot. */
export const KEY_LABELS: Record<string, string[]> = {
  '1': [...nums(1, 6), ...AD], '7': [...nums(1, 6), ...AD],
  '2': [...nums(1, 6), ...AD, ...nums(7, 16)],
  '3': ['1', '2', ...AD], '9': ['#0', '#9', '#1', '#2', '#3', '#4'],
  '4': [...nums(1, 12), ...AD], '8': [...nums(1, 8), ...AD],
  '5': [...nums(1, 6), ...AD, ...new Array(10).fill(''), ...nums(1, 16).map(n => 'F' + n)],
  '6': [...nums(1, 12), ...AD, ...new Array(4).fill(''), ...nums(1, 16).map(n => 'F' + n)],
  '0': nums(1, 40),
};

/** Phantom code families: attr byte -> [prefix, digits, count]. */
export const PHANTOMS: [number, string, number, number][] = [
  [0xc1, 'GRP', 1, 4], [0xc4, 'CA', 2, 12], [0xc3, 'CMA', 1, 8], [0xc5, 'CNF', 1, 8],
  [0xc6, 'EV', 2, 24], [0xcb, 'IS', 2, 24],
];
/** Phantom overlay index base (DS:0x9363) per family; IS has no overlay text. */
const PH_BASE: Record<number, number> = { 0xc1: 0, 0xc4: 4, 0xc3: 16, 0xc5: 24, 0xc6: 32 };

export function phantomName(attr: number, code: number): string | null {
  const f = PHANTOMS.find(p => p[0] === attr);
  if (!f || code < 1 || code > f[3]) return null;
  return f[1] + String(code).padStart(f[2], '0');
}

export function parsePhantom(text: string): [number, number] | null {
  for (const [attr, pre, dig, count] of PHANTOMS) {
    if (text.length === pre.length + dig && text.startsWith(pre)) {
      const n = Number(text.slice(pre.length));
      if (Number.isInteger(n) && n >= 1 && n <= count && /^\d+$/.test(text.slice(pre.length))) return [attr, n];
    }
  }
  return null;
}

export function phantomOverlay(cfg: Cfg, attr: number, code: number): string {
  const b = PH_BASE[attr];
  return b === undefined ? '    ' : (cfg.phantom[b + code - 1] ?? '').padEnd(4).slice(0, 4);
}

/** Field groups, as the Data Transfer items. */
export const GROUPS: Record<string, string[]> = {
  index: ['size', 'mnemonic', 'attr', 'term', 'desc', 'keypad', 'panelmodel'],
  overlay: ['overlay'],
  phantom: ['phantom'],
  ifb: ['ifb_bus', 'ifb_pgm', 'ifb_mode', 'pgm_limit'],
  camera: ['cam', 'cam_flags', 'iso'],
  epc: ['epc'],
  call: ['call'],
  relay: ['relay_out', 'relay_mask'],
  terminal: ['keys', 'groups', 'extkeys'],
};

const MAPS = new Set(['mnemonic', 'attr', 'term', 'desc', 'overlay', 'keys', 'groups']);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function emptyCfg(): Cfg {
  return {
    size: 0, mnemonic: {}, attr: {}, term: {}, desc: {}, overlay: {}, keypad: new Array(18).fill('....'),
    phantom: new Array(60).fill(''), relay_out: new Array(12).fill(0), relay_mask: new Array(12).fill('ff'.repeat(30)),
    ifb_bus: new Array(48).fill(0), ifb_pgm: new Array(48).fill(0), ifb_mode: 0, pgm_limit: 0,
    cam: new Array(96).fill(0), cam_flags: new Array(8).fill(0), iso: new Array(24).fill(0),
    call: Array.from({ length: 12 }, () => new Array(24).fill(0)), epc: [], keys: {}, groups: {},
  };
}

export class Production {
  readonly f: number;
  readonly eng: EngineClient;
  base: Cfg;
  cfg: Cfg;
  baseExt: Record<string, ExtKey[]> = {};
  ext: Record<string, ExtKey[]> = {};
  baseModels: Record<string, string> = {};
  models: Record<string, string> = {};
  dirty = new Set<string>();

  constructor(eng: EngineClient, f: number, cfg: Cfg) {
    this.eng = eng;
    this.f = f;
    this.base = cfg;
    this.cfg = clone(cfg);
    this.loadExtras();
  }

  /** Re-read the engine copy (only when nothing is pending). */
  reset(cfg: Cfg) {
    this.base = cfg;
    this.cfg = clone(cfg);
    this.dirty.clear();
    this.loadExtras();
  }

  private loadExtras() {
    this.baseExt = {};
    this.baseModels = {};
    for (let b = 1; b <= this.N; b++) {
      const g = String(this.gid(b));
      if (this.eng.extKeys[g]) this.baseExt[g] = clone(this.eng.extKeys[g]);
      if (this.eng.panelModels[g]) this.baseModels[g] = this.eng.panelModels[g];
    }
    this.ext = clone(this.baseExt);
    this.models = { ...this.baseModels };
  }

  /** Ports in this production (bus numbers 1..N). */
  get N(): number { return this.eng.slice; }
  gid(bus: number): number { return this.eng.gid(this.f, bus); }
  kind(bus: number): string { return this.eng.kind(this.f, bus); }

  mn(bus: number): string { return (this.cfg.mnemonic[bus] ?? '').padEnd(4).slice(0, 4); }
  ovl(bus: number): string { return (this.cfg.overlay[bus] ?? '').padEnd(4).slice(0, 4); }
  attr(bus: number): number { return this.cfg.attr[bus] ?? 0xc0; }
  term(bus: number): string { return this.cfg.term[bus] ?? '0'; }
  desc(bus: number): string { return (this.cfg.desc[bus] ?? '').padEnd(22).slice(0, 22); }
  model(bus: number): string { return this.models[String(this.gid(bus))] ?? ''; }

  /** Terminal type text for the index table / bus lists (8 chars). */
  typeName(bus: number): string {
    const m = this.model(bus);
    if (m) return m.padEnd(8);
    const t = TERM_NAMES[Number(this.term(bus)) & 0x0f] ?? '';
    if (!t && this.kind(bus) === 'ifb') return 'Talent  ';
    return t.padEnd(8).slice(0, 8);
  }

  hasTerminal(bus: number): boolean { return this.term(bus) !== '0' || !!this.model(bus); }

  /** Bus whose mnemonic is `text` (4 chars, exact), last match wins like MCOM; 0 if none. */
  findBus(text: string): number {
    const t = text.padEnd(4).slice(0, 4);
    let hit = 0;
    for (let b = 1; b <= this.N; b++) if (this.mn(b) === t && t.trim()) hit = b;
    return hit;
  }

  keys(bus: number): number[][] {
    const k = this.cfg.keys[bus];
    return k ? k : Array.from({ length: 40 }, () => [0, 0]);
  }

  setKeys(bus: number, keys: number[][]) {
    this.cfg.keys[bus] = keys;
    this.touch('keys');
  }

  extKeys(bus: number): ExtKey[] { return this.ext[String(this.gid(bus))] ?? []; }

  setExtKeys(bus: number, keys: ExtKey[]) {
    const g = String(this.gid(bus));
    if (keys.length) this.ext[g] = keys; else delete this.ext[g];
    this.touch('extkeys');
  }

  setModel(bus: number, model: string | null) {
    const g = String(this.gid(bus));
    if (model) this.models[g] = model; else delete this.models[g];
    this.touch('panelmodel');
  }

  touch(field: string) {
    this.dirty.add(field);
  }

  /** Fields (of the given list, default all) that differ from the engine copy. */
  changed(fields?: string[]): string[] {
    const all = fields ?? [...Object.keys(this.cfg), 'extkeys', 'panelmodel'];
    return all.filter(f => {
      if (f === 'extkeys') return !same(this.ext, this.baseExt);
      if (f === 'panelmodel') return !same(this.models, this.baseModels);
      return !same((this.cfg as unknown as Record<string, unknown>)[f], (this.base as unknown as Record<string, unknown>)[f]);
    });
  }

  get isDirty(): boolean { return this.changed().length > 0; }

  /** The WebSocket messages that apply the given fields (default: everything changed). */
  messages(fields?: string[]): object[] {
    const ch = this.changed(fields);
    const out: object[] = [];
    const changes: Record<string, unknown> = {};
    for (const f of ch) {
      if (f === 'extkeys' || f === 'panelmodel') continue;
      const cur = (this.cfg as unknown as Record<string, unknown>)[f];
      const old = (this.base as unknown as Record<string, unknown>)[f];
      if (MAPS.has(f)) {
        const c = cur as Record<string, unknown>;
        const o = old as Record<string, unknown>;
        const d: Record<string, unknown> = {};
        for (const k of Object.keys(c)) if (!same(c[k], o[k])) d[k] = c[k];
        for (const k of Object.keys(o)) if (!(k in c)) d[k] = null;
        changes[f] = d;
      } else changes[f] = cur;
    }
    if (Object.keys(changes).length && this.cfg.size === 0 && !('size' in changes)) {
      changes.size = this.eng.profile?.mcomSize ?? 96;       // first programming of an empty production
      this.cfg.size = changes.size as number;
    }
    if (Object.keys(changes).length) out.push({ t: 'setcfg', facility: this.f, changes });
    if (ch.includes('extkeys')) {
      const gids = new Set([...Object.keys(this.ext), ...Object.keys(this.baseExt)]);
      for (const g of gids) {
        if (!same(this.ext[g] ?? [], this.baseExt[g] ?? [])) out.push({ t: 'extkeys', gid: Number(g), keys: this.ext[g] ?? [] });
      }
    }
    if (ch.includes('panelmodel')) {
      const gids = new Set([...Object.keys(this.models), ...Object.keys(this.baseModels)]);
      for (const g of gids) {
        if ((this.models[g] ?? null) !== (this.baseModels[g] ?? null)) out.push({ t: 'panelmodel', gid: Number(g), model: this.models[g] ?? null });
      }
    }
    return out;
  }

  /** Messages applying one station's key assignment (keys + extended keys) or its groups. */
  stationMessages(bus: number, what: 'keys' | 'groups'): object[] {
    const out: object[] = [];
    const k = String(bus);
    const cur = (this.cfg[what] as Record<string, unknown>)[k];
    const old = (this.base[what] as Record<string, unknown>)[k];
    if (!same(cur, old)) out.push({ t: 'setcfg', facility: this.f, changes: { [what]: { [k]: cur ?? null } } });
    if (what === 'keys') {
      const g = String(this.gid(bus));
      if (!same(this.ext[g] ?? [], this.baseExt[g] ?? [])) out.push({ t: 'extkeys', gid: Number(g), keys: this.ext[g] ?? [] });
    }
    return out;
  }

  /** A station's keys/groups were applied: make them part of the engine copy. */
  stationApplied(bus: number, what: 'keys' | 'groups') {
    const k = String(bus);
    const cur = (this.cfg[what] as Record<string, unknown>)[k];
    const base = this.base[what] as Record<string, unknown>;
    if (cur === undefined) delete base[k]; else base[k] = clone(cur);
    if (what === 'keys') {
      const g = String(this.gid(bus));
      if (this.ext[g]) this.baseExt[g] = clone(this.ext[g]); else delete this.baseExt[g];
    }
  }

  /** After a successful apply of `fields`: adopt them as the new engine copy, keep other edits. */
  applied(fresh: Cfg, fields?: string[]) {
    const ch = new Set(this.changed(fields));
    const keep = clone(this.cfg) as unknown as Record<string, unknown>;
    const pending = this.changed().filter(f => !ch.has(f));
    this.base = fresh;
    const next = clone(fresh) as unknown as Record<string, unknown>;
    for (const f of pending) if (f in keep) next[f] = keep[f];
    this.cfg = next as unknown as Cfg;
    if (ch.has('extkeys')) this.baseExt = clone(this.ext);
    if (ch.has('panelmodel')) this.baseModels = { ...this.models };
    this.dirty = new Set(this.changed());
  }
}

/** All working copies of this session (one per production touched) and the active production. */
export class Workspace {
  readonly eng: EngineClient;
  current = 0;
  private prods = new Map<number, Production>();

  constructor(eng: EngineClient) {
    this.eng = eng;
  }

  get(f: number): Production | undefined { return this.prods.get(f); }

  /** The working copy of production f, (re)loaded from the engine unless it has unapplied edits. */
  async load(f = this.current): Promise<Production> {
    const p = this.prods.get(f);
    if (p && p.isDirty) return p;
    const cfg = await this.eng.getConfig(f);
    if (p) { p.reset(cfg); return p; }
    const np = new Production(this.eng, f, cfg);
    this.prods.set(f, np);
    return np;
  }

  dirtyProductions(): number[] {
    return [...this.prods.values()].filter(p => p.isDirty).map(p => p.f);
  }

  /** Apply (some) changes of production f to the matrix. Returns the number of requests sent. */
  async apply(f: number, fields?: string[]): Promise<number> {
    const p = this.prods.get(f);
    if (!p) return 0;
    const msgs = p.messages(fields);
    if (!msgs.length) return 0;
    const fresh = await this.eng.transact(f, msgs);
    // snapshot (extKeys / panelModels) follows asynchronously; trust our copy for those
    p.applied(fresh, fields);
    return msgs.length;
  }
}
