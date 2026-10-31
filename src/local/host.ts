// The front door of the in-browser engine: what mcommatrix/server.py does for WebSocket clients
// (hello, snapshot, per-role views, request handling, intercom audio), plus the frame links and the
// engine's timers. Transport-agnostic: worker.ts carries it over MessagePorts.
import { Access, mayOperate, type Role } from './access';
import { AudioHub, type Send } from './audio';
import * as demo from './demo';
import { Engine, type Msg, type StateStore } from './engine';
import { History } from './history';
import { ByteReader, FacilityLink } from './link';
import { Profile, type ProfileRaw } from './profile';
import { PERIOD, Proximity } from './proximity';
import { PROTOCOL } from '../matrix/types';

const PRODUCER_MODELS = new Set(['M2026P']);

/** Ports a panel link may observe: its own, or its whole production for a producer panel. */
export function viewScope(engine: Engine, gid: number): Set<number> {
  if (PRODUCER_MODELS.has(engine.panelModels[gid])) {
    const f = engine.profile.port(gid).facility, n = engine.profile.slice;
    return new Set(Array.from({ length: n }, (_, i) => f * n + 1 + i));
  }
  return new Set([gid]);
}

type R = Record<string, unknown>;

/** What a panel-link client may see (server.py station_view). */
export function stationView(msg: Msg, gid: number, scope: Set<number>): Msg | null {
  const t = msg.t;
  const routeOk = (r: number[]) => scope.has(r[0]) || scope.has(r[1]);
  const inScope = (d: R = {}) => Object.fromEntries(Object.entries(d).filter(([k]) => scope.has(Number(k))));
  if (t === 'snapshot') {
    const st = msg.state as R;
    return { t: 'snapshot', state: {
      profile: st.profile, ports: st.ports, facilities: [], links: [],
      routes: (st.routes as number[][]).filter(routeOk), relays: [],
      active: (st.active as number[][]).filter(a => a[0] === gid), xt: [], events: [],
      extKeys: {}, panelModels: {}, meta: st.meta ?? {}, facMeta: st.facMeta ?? {},
      talent: inScope(st.talent as R) } };
  }
  if (t === 'routes') {
    return { t: 'routes', routes: (msg.routes as number[][]).filter(routeOk), relays: [],
      active: (msg.active as number[][]).filter(a => a[0] === gid), xt: [], talent: inScope(msg.talent as R) };
  }
  if (t === 'meta' || t === 'facmeta' || t === 'blip') return msg;
  if (t === 'near') return { t: 'near', near: (msg.near as number[][]).filter(p => p.slice(0, 2).includes(gid)) };
  if (t === 'said') {
    const it = msg.item as { src: number; dsts: number[] };
    return scope.has(it.src) || it.dsts.some(d => scope.has(d)) ? msg : null;
  }
  if (t === 'levels') {
    const lv = inScope(msg.levels as R);
    return Object.keys(lv).length ? { t: 'levels', levels: lv } : null;
  }
  return null;                                    // events, links: operator only
}

export interface Out { json(m: Msg): void; binary(b: ArrayBuffer): void }
export interface Conn { message(data: string | ArrayBuffer): void; close(): void }

const STATION_OPS = new Set(['key', 'station', 'panellink', 'talent', 'meta', 'history', 'heard', 'near']);
const num = (x: unknown) => {
  const n = typeof x === 'string' && /^\s*[+-]?\d+\s*$/.test(x) ? parseInt(x, 10) : x;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`invalid number ${JSON.stringify(x)}`);
  return Math.trunc(n);
};
const b64bytes = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export class Host {
  readonly engine: Engine;
  readonly history: History;
  readonly audio: AudioHub;
  readonly proximity: Proximity;
  readonly links = new Map<number, FacilityLink>();
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(readonly access: Access, profile: Profile, store: StateStore | null, state: unknown, tones = true) {
    this.engine = new Engine(profile, store, state);
    if (!state) {
      [this.engine.facilities, this.engine.extKeys, this.engine.panelModels] = demo.build(profile);
      [this.engine.meta, this.engine.facMeta] = demo.buildMeta(profile, this.engine.facilities);
      this.engine.log('config', 'demo programming loaded for all facilities');
      this.engine.recompute(false);
      this.engine.save();
    }
    this.history = new History(this.engine);
    this.audio = new AudioHub(this.engine, tones, this.history);
    this.proximity = new Proximity(this.engine, this.audio, this.history);
    for (let f = 0; f < profile.facilities; f++) {
      const link = new FacilityLink(this.engine, f, profile.tcpBase + f);
      this.links.set(f, link);
      this.engine.links.set(f, link);
    }
    const p = profile;
    this.engine.log('system', `matrix up: ${p.ports} ports, ${p.facilities} facilities x ${p.slice}; ` +
      'running in this browser (local engine), serial links in-browser');
  }

  static profileFrom(raw?: Partial<ProfileRaw>) { return new Profile(raw); }

  /** Start the engine's clocks (ticker, mixer, meters, proximity). */
  start() {
    this.timers.push(setInterval(() => this.engine.tick(), 150));
    this.timers.push(setInterval(() => this.audio.pump(performance.now() / 1000), 10));
    this.timers.push(setInterval(() => this.audio.meters(), 120));
    const prox = () => {
      this.timers.push(setTimeout(() => { this.proximity.round(); prox(); }, PERIOD * (0.7 + 0.6 * Math.random()) * 1000));
    };
    prox();
  }

  stop() {
    for (const t of this.timers) { clearInterval(t); clearTimeout(t); }
    this.timers = [];
    this.engine.save();
  }

  // ---- a client connection (server.py ws_handler) --------------------------------------------
  connect(token: string | null, pageUrl: string, out: Out): Conn {
    const engine = this.engine;
    const role = this.access.role(token);
    const view = role.admin ? (m: Msg) => m : (m: Msg) => stationView(m, role.gid!, viewScope(engine, role.gid!));
    let audioGid: number | null = null;
    const sendAudio: Send = b => out.binary(b);
    const sub = (m: Msg) => { const v = view(m); if (v) out.json(v); };
    out.json({ t: 'hello', admin: role.admin, gid: role.gid, proto: PROTOCOL });
    const first = view({ t: 'snapshot', state: engine.snapshot() });
    if (first) out.json(first);
    engine.subscribers.add(sub);
    let closed = false;
    return {
      message: data => {
        if (closed) return;
        if (data instanceof ArrayBuffer) {
          if (audioGid) this.audio.micFrame(audioGid, data);
          return;
        }
        let reply: Msg | null;
        try {
          const msg = JSON.parse(data) as R;
          if (msg.t === 'audio') {
            const gid = num(msg.gid || role.gid || 0);
            if (!mayOperate(role, gid)) throw new Error('not your panel');
            if (audioGid) { this.audio.removeListener(audioGid, sendAudio); audioGid = null; }
            if (msg.on && gid) { this.audio.addListener(gid, sendAudio); audioGid = gid; }
            reply = { t: 'audio', on: !!audioGid, gid: audioGid };
          } else {
            reply = this.handle(role, msg, pageUrl);
          }
        } catch (e) {
          reply = { t: 'error', message: e instanceof Error ? e.message : String(e) };
        }
        if (reply) out.json(reply);
      },
      close: () => {
        if (closed) return;
        closed = true;
        engine.subscribers.delete(sub);
        if (audioGid) this.audio.removeListener(audioGid, sendAudio);
      },
    };
  }

  /** Panel URL for a station: same site as the page asking, panel.html?p=PROD01/PNL01&k=<token>. */
  panelLink(gid: number, pageUrl: string): string {
    const [fac, name] = this.engine.profile.port(gid).label.split(' ');
    const u = new URL('panel.html', pageUrl);
    u.search = `?p=${encodeURIComponent(fac)}/${encodeURIComponent(name)}&k=${encodeURIComponent(this.access.panelToken(gid))}`;
    return u.href;
  }

  /** server.py handle(). */
  handle(role: Role, msg: R, pageUrl = 'http://localhost/'): Msg | null {
    const engine = this.engine;
    const t = msg.t as string;
    if (!role.admin) {
      if (!STATION_OPS.has(t) || num(msg.gid ?? 0) !== role.gid) throw new Error('this link only operates its own panel');
      if (t === 'meta' && Object.keys((msg.meta as R) ?? {}).some(k => k !== 'name' && k !== 'emoji')) {
        throw new Error('a panel may only set its own name and emoji');
      }
    }
    const need = (k: string) => { if (!(k in msg)) throw new Error(`'${k}'`); return msg[k]; };
    switch (t) {
      case 'key': engine.key(num(need('gid')), num(need('slot')), (msg.action as string) ?? 'toggle'); break;
      case 'station': return { t: 'station', station: engine.station(num(need('gid'))) };
      case 'meta': engine.setMeta(num(need('gid')), need('meta') as R); break;
      case 'facmeta': engine.setFacMeta(num(need('facility')), need('meta') as R); break;
      case 'getcfg': { const f = num(need('facility')); return { t: 'cfg', facility: f, cfg: engine.getConfig(f) }; }
      case 'setcfg': engine.setConfig(num(need('facility')), need('changes') as R); break;
      case 'heard': this.proximity.heard(num(need('gid')), num(need('blip')), num(need('emitter')), Number(need('snr'))); break;
      case 'near': {
        const pairs = this.proximity.near();
        return { t: 'near', near: role.admin ? pairs : pairs.filter(p => p.slice(0, 2).includes(role.gid!)) };
      }
      case 'history': {
        const gid = num(need('gid'));
        return { t: 'history', gid, items: this.history.forPorts(viewScope(engine, gid)) };
      }
      case 'talent': engine.setTalent(num(need('gid')), msg.mic as boolean | undefined, msg.cough as boolean | undefined); break;
      case 'panellink': { const gid = num(need('gid')); return { t: 'panellink', gid, url: this.panelLink(gid, pageUrl) }; }
      case 'xt': engine.setXt(num(need('facility')), num(need('n')), !!need('on')); break;
      case 'clear': engine.clear(); break;
      case 'extkeys': engine.setExtKeys(num(need('gid')), need('keys') as never); break;
      case 'panelmodel': engine.setPanelModel(num(need('gid')), (msg.model as string) || null); break;
      case 'fault': {
        const link = this.links.get(num(need('facility')));
        if (!link) throw new Error(String(msg.facility));
        Object.assign(link.faults, need('faults'));
        engine.log('link', `fault injection ${pyDict(link.faults)}`, link.facility);
        engine.changed('links');
        break;
      }
      case 'import': {
        // the browser engine has no file system: send the setup's files (base64) instead of a directory
        const files = msg.files as Record<string, string> | undefined;
        if (!files?.mtx) throw new Error('import: the browser engine needs files {mtx, ova?, tma?, epc?} (base64), not a directory');
        const dec = (k: string) => (files[k] ? b64bytes(files[k]) : undefined);
        engine.importSetup(num(need('facility')), { mtx: dec('mtx')!, ova: dec('ova'), tma: dec('tma'), epc: dec('epc') },
          (msg.setup as string) ?? 'MCOMFILE');
        break;
      }
      default: return { t: 'error', message: `unknown request '${t}'` };
    }
    return null;
  }

  /** server.py api_clip: a recorded talk segment as WAV, for the operator or a station that received it. */
  clip(token: string | null, id: number): ArrayBuffer | null {
    const role = this.access.role(token);
    const seg = this.history.get(id);
    if (!seg) return null;
    const scope = role.admin ? new Set<number>() : viewScope(this.engine, role.gid!);
    if (!(role.admin || scope.has(seg.src) || [...seg.dsts].some(d => scope.has(d)))) return null;
    return History.wav(seg);
  }

  /** Attach a PC (MCOM.EXE's COM1) to facility f's frame link. */
  attachLink(f: number, toPc: (b: Uint8Array) => void): { send(b: Uint8Array): void; close(): void } {
    const link = this.links.get(f);
    if (!link) throw new Error(`no such facility ${f}`);
    const reader = new ByteReader();
    queueMicrotask(() => void link.serve(reader, toPc));     // after the caller holds the handle
    return { send: b => reader.push(b), close: () => reader.end() };
  }
}

function pyDict(o: object): string {
  const v = (x: unknown) => (x === true ? 'True' : x === false ? 'False' : typeof x === 'string' ? `'${x}'` : String(x));
  return `{${Object.entries(o).map(([k, x]) => `'${k}': ${v(x)}`).join(', ')}}`;
}
