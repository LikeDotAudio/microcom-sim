// Matrix engine: facility configs, live key state, routes, relays, event log, persistence, pub/sub.
// Port of mcommatrix/engine.py; runs in the browser (SharedWorker) instead of the Python server.
import { FacilityConfig, KEY_LABELS, TERMINALS, phantomName, type FacilityJson, type McomFiles, type Pending } from './config';
import { Profile } from './profile';
import { akey, compute, routeJson, unkey, type Active, type ExtKey, type Route } from './routing';

export const PANEL_MODELS: Record<string, number> = { M7832: 32, M7864: 64, M2026: 32, M2026P: 32 };

export type Msg = Record<string, unknown> & { t: string };
export interface LogEntry { id: number; t: number; kind: string; text: string; facility: number | null }
export interface Talent { mic: boolean; cough: boolean }
export interface LinkLike { status(): Record<string, unknown> }
export interface StateStore { save(state: unknown): void }

export const now = () => Date.now() / 1000;
const tupleSort = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1];

const META_FIELDS = new Set(['name', 'role', 'emoji', 'location']);
const LOCATION_FIELDS = new Set(['site', 'building', 'floor', 'room', 'row', 'seat', 'x', 'y', 'lat', 'lon']);
const FAC_FIELDS = new Set(['name', 'site', 'building', 'lat', 'lon']);
const CFG_MAPS = new Set(['mnemonic', 'attr', 'term', 'desc', 'overlay', 'keys', 'groups']);
const CFG_SCALARS = new Set(['size', 'ifb_mode', 'pgm_limit']);
const CFG_LISTS = new Set(['keypad', 'phantom', 'relay_out', 'relay_mask', 'ifb_bus', 'ifb_pgm', 'cam',
  'cam_flags', 'iso', 'call', 'epc']);

const intKeys = <T>(o: Record<string, T> | undefined): Record<number, T> => ({ ...(o ?? {}) });

export class Engine {
  facilities: FacilityConfig[];
  active: Active = new Map();
  xt = new Set<string>();                         // "f,n" external triggers on
  extKeys: Record<number, ExtKey[]> = {};
  panelModels: Record<number, string> = {};
  talent: Record<number, Talent> = {};
  meta: Record<number, Record<string, unknown>> = {};
  facMeta: Record<number, Record<string, unknown>> = {};
  routes = new Map<string, Route>();
  relays = new Map<string, boolean>();
  events: LogEntry[] = [];
  seq = 0;
  subscribers = new Set<(m: Msg) => void>();
  links = new Map<number, LinkLike>();
  private dirty = new Set<string>();
  private saveDue = 0;

  constructor(readonly profile: Profile, private store: StateStore | null = null, state: unknown = null) {
    this.facilities = Array.from({ length: profile.facilities }, () => new FacilityConfig());
    if (state) this.load(state as Record<string, never>);
    this.recompute(false);
  }

  // ---- persistence -------------------------------------------------------------------
  load(d: Record<string, unknown>) {
    ((d.facilities as (Partial<FacilityJson> | null)[]) ?? []).slice(0, this.facilities.length).forEach((fc, i) => {
      if (fc) this.facilities[i] = FacilityConfig.fromJson(fc);
    });
    this.extKeys = intKeys(d.extKeys as Record<string, ExtKey[]>);
    this.panelModels = intKeys(d.panelModels as Record<string, string>);
    this.meta = intKeys(d.meta as Record<string, Record<string, unknown>>);
    this.facMeta = intKeys(d.facMeta as Record<string, Record<string, unknown>>);
  }

  state() {
    return JSON.parse(JSON.stringify({
      facilities: this.facilities.map((fc, i) => (this.configured(i) ? fc.toJson() : null)),
      extKeys: this.extKeys, panelModels: this.panelModels, talent: this.talentJson(),
      meta: this.meta, facMeta: this.facMeta }));
  }

  save() { this.store?.save(this.state()); }

  configured(f: number): boolean {
    const c = this.facilities[f];
    return !!(c.size || Object.keys(c.keys).length || c.epc.length);
  }

  // ---- events / pub-sub ----------------------------------------------------------------
  log(kind: string, text: string, facility: number | null = null) {
    this.seq += 1;
    const e: LogEntry = { id: this.seq, t: now(), kind, text, facility };
    this.events.push(e);
    if (this.events.length > 1000) this.events.shift();
    this.publish({ t: 'event', e });
  }

  publish(msg: Msg) { for (const s of [...this.subscribers]) s(msg); }

  changed(what: string) { this.dirty.add(what); }

  /** One ticker step (every 0.15 s): coalesces state broadcasts and saves. */
  tick() {
    if (this.dirty.size) {
      const dirty = this.dirty;
      this.dirty = new Set();
      if (dirty.has('config')) {
        this.recompute();
        this.publish({ t: 'snapshot', state: this.snapshot() });
        this.saveDue = now() + 1.0;
      } else if (dirty.has('links')) {
        this.publish({ t: 'links', links: this.linkStatus() });
      }
    }
    if (this.saveDue && now() > this.saveDue) {
      this.saveDue = 0;
      this.save();
    }
  }

  // ---- configuration input ----------------------------------------------------------------
  applyBlock(f: number, typ: number, blk: number, data: Uint8Array, pending: Pending) {
    const desc = this.facilities[f].applyBlock(typ, blk, data, pending);
    if (desc) this.changed('config');
  }

  importSetup(f: number, files: McomFiles, setup = 'MCOMFILE', from = 'uploaded files') {
    this.facilities[f] = FacilityConfig.fromMcomFiles(files);
    this.log('upload', `imported setup ${setup} from ${from}`, f);
    this.changed('config');
  }

  // ---- live control ------------------------------------------------------------------------
  key(gid: number, slot: number, action: string) {
    const k = akey(gid, slot);
    const before = this.active.has(k);
    if (action === 'press') {
      if (!before) this.active.set(k, 'press');
    } else if (action === 'release') {
      if (this.active.get(k) === 'press') this.active.delete(k);
    } else if (action === 'toggle') {
      if (before) this.active.delete(k); else this.active.set(k, 'latch');
    }
    if (this.active.has(k) !== before) {
      const lbl = this.keyLabel(gid, slot);
      const p = this.profile.port(gid);
      this.log('key', `${p.label} ${lbl} ${this.active.has(k) ? 'ON' : 'off'}`, p.facility);
      this.recompute();
    }
  }

  setXt(f: number, n: number, on: boolean) {
    const k = `${f},${n}`;
    if (this.xt.has(k) !== on) {
      if (on) this.xt.add(k); else this.xt.delete(k);
      this.log('xt', `external trigger XT${String(n).padStart(2, '0')} ${on ? 'ON' : 'off'}`, f);
      this.recompute();
    }
  }

  clear() {
    this.active.clear();
    this.xt.clear();
    this.log('key', 'all keys and triggers cleared');
    this.recompute();
  }

  setExtKeys(gid: number, keys: ExtKey[]) {
    this.extKeys[gid] = keys;
    for (const k of [...this.active.keys()]) {
      const [g, s] = unkey(k);
      if (g === gid && s >= 100) this.active.delete(k);
    }
    this.log('config', `${this.profile.port(gid).label}: ${keys.length} extended keys`, null);
    this.changed('config');
    this.saveDue = now() + 1.0;
  }

  setPanelModel(gid: number, model: string | null) {
    if (model && !(model in PANEL_MODELS)) throw new Error(`unknown panel model '${model}'`);
    if (model) this.panelModels[gid] = model; else delete this.panelModels[gid];
    const p = this.profile.port(gid);
    this.log('config', `${p.label}: panel ${model || 'from MCOM terminal type'}`, p.facility);
    this.changed('config');
    this.saveDue = now() + 1.0;
  }

  talentState(gid: number): Talent { return this.talent[gid] ?? { mic: true, cough: false }; }

  setTalent(gid: number, mic?: boolean | null, cough?: boolean | null) {
    const p = this.profile.port(gid);
    if (p.kind !== 'ifb') throw new Error(`${p.label} is not a talent (IFB/Mic) position`);
    const before = { ...this.talentState(gid) };
    const st = { ...before };
    if (mic !== undefined && mic !== null) st.mic = !!mic;
    if (cough !== undefined && cough !== null) st.cough = !!cough;
    if (st.mic === before.mic && st.cough === before.cough) return;
    this.talent[gid] = st;
    if (st.mic !== before.mic) this.log('talent', `${p.label} mic ${st.mic ? 'ON' : 'OFF'}`, p.facility);
    if (st.cough !== before.cough) this.log('talent', `${p.label} cough ${st.cough ? 'down' : 'up'}`, p.facility);
    this.recompute();
  }

  // ---- people and places (MicroCOM 2026) ---------------------------------------------------
  setMeta(gid: number, meta: Record<string, unknown>) {
    this.profile.port(gid);
    const cur: Record<string, unknown> = { ...(this.meta[gid] ?? {}) };
    for (const [k, v] of Object.entries(meta)) {
      if (!META_FIELDS.has(k)) throw new Error(`unknown field '${k}'`);
      if (k === 'location') {
        const loc: Record<string, unknown> = { ...((cur.location as object) ?? {}) };
        for (const [lk, lv] of Object.entries((v as object) ?? {})) {
          if (!LOCATION_FIELDS.has(lk)) throw new Error(`unknown location field '${lk}'`);
          loc[lk] = lv;
        }
        cur.location = loc;
      } else if (v === null || v === undefined || v === '') {
        delete cur[k];
      } else {
        cur[k] = [...pyStr(v)].slice(0, 64).join('');
      }
    }
    this.meta[gid] = cur;
    this.publish({ t: 'meta', gid, meta: cur });
    this.saveDue = now() + 1.0;
  }

  setFacMeta(f: number, meta: Record<string, unknown>) {
    if (!(f >= 0 && f < this.profile.facilities)) throw new Error('no such production');
    const cur: Record<string, unknown> = { ...(this.facMeta[f] ?? {}) };
    for (const [k, v] of Object.entries(meta)) {
      if (!FAC_FIELDS.has(k)) throw new Error(`unknown field '${k}'`);
      cur[k] = v;
    }
    this.facMeta[f] = cur;
    this.publish({ t: 'facmeta', facility: f, meta: cur });
    this.saveDue = now() + 1.0;
  }

  // ---- configuration API (MicroCOM III) ------------------------------------------------------
  getConfig(f: number): FacilityJson { return this.facilities[f].toJson(); }

  /** Merge changes into a production's configuration. Maps take {bus: value} (null deletes),
   * lists and scalars are replaced whole. */
  setConfig(f: number, changes: Record<string, unknown>) {
    const cfg = this.facilities[f] as unknown as Record<string, unknown>;
    if (!cfg) throw new Error('list index out of range');
    for (const [field, val] of Object.entries(changes)) {
      if (CFG_MAPS.has(field)) {
        const m = cfg[field] as Record<number, unknown>;
        for (const [k, v] of Object.entries(val as object)) {
          const ik = pyIntKey(k);
          if (v === null) delete m[ik]; else m[ik] = v;
        }
      } else if (CFG_LISTS.has(field)) {
        const old = cfg[field] as unknown[];
        if (!Array.isArray(val) || (field !== 'epc' && val.length !== old.length)) {
          throw new Error(`${field} must be a list of ${old.length}`);
        }
        cfg[field] = val;
      } else if (CFG_SCALARS.has(field)) {
        cfg[field] = pyIntKey(val);
      } else {
        throw new Error(`unknown configuration field '${field}'`);
      }
    }
    this.log('config', `${this.profile.fname(f)} configuration changed: ${Object.keys(changes).join(', ')}`, f);
    this.changed('config');
  }

  recompute(log = true) {
    const muted = new Set<number>();
    for (const [g, t] of Object.entries(this.talent)) if (!t.mic || t.cough) muted.add(Number(g));
    const [routes, relays] = compute(this.profile, this.facilities, this.active, this.xt, this.extKeys, muted);
    if (log) {
      for (const [k, closed] of relays) {
        if ((this.relays.get(k) ?? false) !== closed) {
          const [f, r] = k.split(',').map(Number);
          this.log('relay', `relay ${r} ${closed ? 'CLOSED' : 'open'}`, f);
        }
      }
    }
    this.routes = routes;
    this.relays = relays;
    this.publish({ t: 'routes', routes: [...routes.values()].map(routeJson), relays: this.relayJson(),
      active: this.activeJson(), xt: this.xtJson(), talent: this.talentJson() });
  }

  // ---- views ----------------------------------------------------------------------------------
  keyLabel(gid: number, slot: number): string {
    if (slot >= 100) {
      const ek = this.extKeys[gid] ?? [];
      return slot - 100 < ek.length ? ek[slot - 100].label : `X${slot - 99}`;
    }
    return `key ${slot + 1}`;
  }

  describeKey(f: number, code: number, attr: number): Record<string, unknown> {
    const cfg = this.facilities[f];
    if (!code || code === 0xff) return { kind: 'empty', name: '' };
    const name = phantomName(attr, code);
    if (name) return { kind: 'phantom', name };
    const mode = ([['T', 0x40], ['L', 0x80], ['M', 0x20]] as [string, number][]).filter(([, b]) => attr & b).map(([c]) => c).join('');
    return { kind: 'bus', name: cfg.mnemonic[code] ?? String(code).padStart(3, '0'), bus: code,
      target: this.profile.gid(f, code), mode };
  }

  station(gid: number): Record<string, unknown> {
    const p = this.profile.port(gid);
    const cfg = this.facilities[p.facility];
    const ttype = cfg.term[p.local] ?? '0';
    const keys = cfg.keys[p.local];
    const out: Record<string, unknown>[] = [];
    if (keys && keys.length) {
      const nkeys = ttype !== '0' ? (TERMINALS[ttype] ?? TERMINALS['0'])[0] : 40;
      const labels = KEY_LABELS[ttype] ?? KEY_LABELS['0'];
      for (let s = 0; s < Math.min(40, Math.max(nkeys, labels.length)); s++) {
        const lbl = s < labels.length ? labels[s] : '';
        if (!lbl) continue;
        const [code, attr] = keys[s];
        out.push({ ...this.describeKey(p.facility, code, attr), slot: s, label: lbl, code, attr,
          on: this.active.get(akey(gid, s)) ?? null });
      }
    }
    (this.extKeys[gid] ?? []).forEach((k, i) => {
      out.push({ slot: 100 + i, label: `X${i + 1}`, kind: 'ext', name: k.label, targets: k.targets,
        on: this.active.get(akey(gid, 100 + i)) ?? null });
    });
    const model = this.panelModels[gid] ?? null;
    let talent: Record<string, unknown> | null = null;
    if (p.kind === 'ifb') {
      const n = cfg.ifbNumberOf(p.local);
      const pgm = n && cfg.ifb_pgm[n - 1] !== 0 && cfg.ifb_pgm[n - 1] !== 0xff ? this.profile.gid(p.facility, cfg.ifb_pgm[n - 1]) : null;
      talent = { ...this.talentState(gid), ifb: n, pgm };
    }
    return { talent, gid, label: p.label, kind: p.kind, facility: p.facility,
      panelModel: model, capacity: (model && PANEL_MODELS[model]) || 0,
      local: p.local, type: ttype, typeName: (TERMINALS[ttype] ?? ['', 0, 0, ''])[3],
      mnemonic: cfg.mnemonic[p.local] ?? '', overlay: cfg.overlay[p.local] ?? '',
      keys: out, groups: cfg.groups[p.local] ?? [] };
  }

  portsJson(): unknown[] {
    return this.profile.portList.map(p => {
      const cfg = this.facilities[p.facility];
      return [p.gid, p.kind, p.label, cfg.mnemonic[p.local] ?? '', cfg.overlay[p.local] ?? '', cfg.term[p.local] ?? '',
        (cfg.keys[p.local]?.length) || p.gid in this.extKeys ? 1 : 0];
    });
  }

  facilitiesJson(): unknown[] {
    return this.facilities.map((cfg, f) => ({ id: f, configured: this.configured(f), size: cfg.size,
      ifbMode: cfg.ifb_mode, pgmLimit: cfg.pgm_limit, keypad: cfg.keypad, phantom: cfg.phantom,
      relayOut: cfg.relay_out, epc: cfg.epc, call: cfg.call, cam: cfg.cam, camFlags: cfg.cam_flags, iso: cfg.iso,
      ifbBus: cfg.ifb_bus, ifbPgm: cfg.ifb_pgm }));
  }

  relayJson() {
    return [...this.relays].map(([k, closed]) => [...k.split(',').map(Number), closed] as [number, number, boolean])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }

  activeJson() { return [...this.active].map(([k, m]) => [...unkey(k), m]); }
  xtJson() { return [...this.xt].map(k => k.split(',').map(Number)).sort(tupleSort); }
  talentJson() { return Object.fromEntries(Object.entries(this.talent).map(([g, t]) => [String(g), t])); }
  linkStatus() { return [...this.links.values()].map(l => l.status()); }

  snapshot(): Record<string, unknown> {
    return { profile: this.profile.describe(), ports: this.portsJson(), facilities: this.facilitiesJson(),
      links: this.linkStatus(), routes: [...this.routes.values()].map(routeJson), relays: this.relayJson(),
      active: this.activeJson(), xt: this.xtJson(), events: this.events.slice(-300),
      extKeys: this.extKeys, panelModels: this.panelModels, talent: this.talentJson(),
      meta: this.meta, facMeta: this.facMeta };
  }
}

/** Python str(v) for the JSON value types a client can send. */
function pyStr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === true) return 'True';
  if (v === false) return 'False';
  return String(v);
}

/** Python int(x) for JSON keys/values (strings of digits or numbers). */
function pyIntKey(x: unknown): number {
  if (typeof x === 'number') { if (!Number.isFinite(x)) throw new Error('cannot convert to int'); return Math.trunc(x); }
  if (typeof x === 'boolean') return x ? 1 : 0;
  const s = String(x).trim();
  if (!/^[+-]?\d+$/.test(s)) throw new Error(`invalid literal for int() with base 10: '${String(x)}'`);
  return parseInt(s, 10);
}
