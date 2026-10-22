// State store: applies server messages, keeps derived indices (routes by src/dst, tallies). No DOM.
import {
  LISTEN_KINDS, TALK_KINDS,
  type ExtKey, type FacilityInfo, type LinkStatus, type LogEvent, type Port, type ProfileInfo,
  type Route, type RouteTuple, type ServerMsg, type Snapshot, type Station, type TalentMap, type TalentState,
  type Blip, type FacMeta, type NearPair, type PersonMeta, type SaidItem,
} from './types';
import { setFacilityPrefix } from './dom';

export type StoreTopic = 'snapshot' | 'routes' | 'event' | 'links' | 'station' | 'error' | 'conn' | 'ui'
  | 'hello' | 'panellink' | 'audio' | 'levels' | 'meta' | 'said' | 'near' | 'blip';
type Listener = (topic: StoreTopic, data?: unknown) => void;

export const MAX_EVENTS = 1000;
/** 'recently said' segments are kept this long by the engine (seconds) */
export const SAID_KEEP = 600;

export interface Tally { talking: boolean; talkedTo: boolean; listening: boolean }
const NO_TALLY: Tally = { talking: false, talkedTo: false, listening: false };

export const routeKey = (src: number, dst: number) => src * 4096 + dst;

export function toRoute(t: RouteTuple): Route {
  return { src: t[0], dst: t[1], kind: t[2], gain: t[3], via: t[4] };
}

export class Store {
  profile: ProfileInfo | null = null;
  ports: Port[] = [];                       // index gid-1
  facilities: FacilityInfo[] = [];
  links = new Map<number, LinkStatus>();
  routes: Route[] = [];
  routeIndex = new Map<number, Route>();    // routeKey(src,dst) -> route
  bySrc = new Map<number, Route[]>();
  byDst = new Map<number, Route[]>();
  tally = new Map<number, Tally>();
  relays = new Map<string, boolean>();      // `${f}:${r}` (f 0-based)
  active = new Map<string, 'latch' | 'press'>(); // `${gid}:${slot}`
  xt = new Set<string>();                   // `${f}:${n}`
  events: LogEvent[] = [];                  // oldest first
  extKeys = new Map<number, ExtKey[]>();
  station: Station | null = null;
  connected = false;
  lastError = '';
  /** what this connection may do: the local operator (admin) or one panel unlocked by a link */
  role: { admin: boolean; gid: number | null } = { admin: true, gid: null };
  /** shareable panel URLs received from the engine, by gid */
  panelLinks = new Map<number, string>();
  audioGid: number | null = null;
  /** talent turret state (IFB/Mic ports); absent = mic on, no cough */
  talent = new Map<number, TalentState>();
  /** live microphone RMS levels by gid (VU meters) */
  levels = new Map<number, number>();
  /** MicroCOM 2026: people & places by gid / facility */
  meta = new Map<number, PersonMeta>();
  facMeta = new Map<number, FacMeta>();
  /** recently said segments (history replies + live 'said'), by id */
  said = new Map<number, SaidItem>();
  /** learned same-room pairs */
  near: NearPair[] = [];
  /** monotonically increasing; bumps on every routes/snapshot application */
  routesVersion = 0;

  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(topic: StoreTopic, data?: unknown) {
    for (const fn of this.listeners) fn(topic, data);
  }

  setConnected(on: boolean) {
    this.connected = on;
    this.emit('conn');
  }

  get slice() { return this.profile?.slice ?? 64; }
  get facilityCount() { return this.profile?.facilities ?? 32; }
  get portCount() { return this.profile?.ports ?? this.ports.length; }

  port(gid: number): Port | undefined { return this.ports[gid - 1]; }
  label(gid: number): string { return this.ports[gid - 1]?.label ?? `#${gid}`; }
  facilityOf(gid: number): number { return Math.floor((gid - 1) / this.slice); }
  gid(facility: number, local: number): number { return facility * this.slice + local; }
  getTally(gid: number): Tally { return this.tally.get(gid) ?? NO_TALLY; }
  isActive(gid: number, slot: number) { return this.active.get(`${gid}:${slot}`) ?? null; }
  relayClosed(f: number, r: number): boolean | undefined { return this.relays.get(`${f}:${r}`); }
  xtOn(f: number, n: number) { return this.xt.has(`${f}:${n}`); }
  route(src: number, dst: number) { return this.routeIndex.get(routeKey(src, dst)); }

  apply(msg: ServerMsg) {
    switch (msg.t) {
      case 'snapshot': this.applySnapshot(msg.state); this.emit('snapshot'); break;
      case 'routes':
        this.setRoutes(msg.routes);
        this.setRelays(msg.relays);
        this.setActive(msg.active);
        this.setXt(msg.xt);
        if (msg.talent) this.setTalent(msg.talent);
        this.emit('routes');
        break;
      case 'event': this.addEvent(msg.e); this.emit('event', msg.e); break;
      case 'links': this.setLinks(msg.links); this.emit('links'); break;
      case 'station': this.station = msg.station; this.emit('station'); break;
      case 'error': this.lastError = msg.message; this.emit('error', msg.message); break;
      case 'hello': this.role = { admin: msg.admin, gid: msg.gid }; this.emit('hello'); break;
      case 'panellink': this.panelLinks.set(msg.gid, msg.url); this.emit('panellink', msg); break;
      case 'audio': this.audioGid = msg.on ? msg.gid : null; this.emit('audio'); break;
      case 'levels':
        this.levels = new Map(Object.entries(msg.levels).map(([k, v]) => [Number(k), v]));
        this.emit('levels');
        break;
      case 'meta': this.meta.set(msg.gid, msg.meta); this.emit('meta', msg.gid); break;
      case 'facmeta': this.facMeta.set(msg.facility, msg.meta); this.emit('meta', -1 - msg.facility); break;
      case 'history': for (const it of msg.items) this.addSaid(it, false); this.emit('said', msg.gid); break;
      case 'said': this.addSaid(msg.item, true); this.emit('said', msg.item); break;
      case 'near': this.near = msg.near; this.emit('near'); break;
      case 'blip': { const { t: _t, ...b } = msg; this.emit('blip', b as Blip); break; }
    }
  }

  /** Upsert a said segment and drop anything older than the engine's 10-minute buffer. */
  addSaid(it: SaidItem, live: boolean, now = Date.now() / 1000) {
    const old = this.said.get(it.id);
    this.said.set(it.id, old ? { ...old, ...it, text: it.text ?? old.text, words: it.words ?? old.words } : it);
    if (live || this.said.size > 2000) {
      for (const [id, s] of this.said) if (s.t1 < now - SAID_KEEP) this.said.delete(id);
    }
  }

  personOf(gid: number): PersonMeta { return this.meta.get(gid) ?? {}; }

  applySnapshot(s: Snapshot) {
    this.profile = s.profile;
    setFacilityPrefix(s.profile.facilityPrefix);
    const slice = s.profile.slice;
    this.ports = s.ports.map(p => ({
      gid: p[0], kind: p[1], label: p[2], mnemonic: (p[3] ?? '').trim(), overlay: (p[4] ?? '').trim(),
      termType: p[5] ?? '', hasKeys: !!p[6],
      facility: Math.floor((p[0] - 1) / slice), local: ((p[0] - 1) % slice) + 1,
    }));
    this.facilities = s.facilities;
    this.setLinks(s.links);
    this.setRoutes(s.routes);
    this.setRelays(s.relays);
    this.setActive(s.active);
    this.setXt(s.xt);
    this.events = s.events.slice(-MAX_EVENTS);
    this.extKeys = new Map(Object.entries(s.extKeys ?? {}).map(([k, v]) => [Number(k), v]));
    this.setTalent(s.talent ?? {});
    this.meta = new Map(Object.entries(s.meta ?? {}).map(([k, v]) => [Number(k), v]));
    this.facMeta = new Map(Object.entries(s.facMeta ?? {}).map(([k, v]) => [Number(k), v]));
  }

  setTalent(t: TalentMap) {
    this.talent = new Map(Object.entries(t).map(([k, v]) => [Number(k), v]));
  }

  talentOf(gid: number): TalentState { return this.talent.get(gid) ?? { mic: true, cough: false }; }

  setRoutes(tuples: RouteTuple[]) {
    const routes = tuples.map(toRoute);
    const idx = new Map<number, Route>();
    const bySrc = new Map<number, Route[]>();
    const byDst = new Map<number, Route[]>();
    const tally = new Map<number, Tally>();
    const t = (g: number) => {
      let v = tally.get(g);
      if (!v) tally.set(g, v = { talking: false, talkedTo: false, listening: false });
      return v;
    };
    for (const r of routes) {
      idx.set(routeKey(r.src, r.dst), r);
      let a = bySrc.get(r.src); if (!a) bySrc.set(r.src, a = []); a.push(r);
      let b = byDst.get(r.dst); if (!b) byDst.set(r.dst, b = []); b.push(r);
      if (r.gain <= 0) continue;
      if (TALK_KINDS.has(r.kind)) { t(r.src).talking = true; t(r.dst).talkedTo = true; }
      else if (LISTEN_KINDS.has(r.kind)) t(r.dst).listening = true;
    }
    this.routes = routes;
    this.routeIndex = idx;
    this.bySrc = bySrc;
    this.byDst = byDst;
    this.tally = tally;
    this.routesVersion++;
  }

  setRelays(relays: [number, number, boolean][]) {
    this.relays = new Map(relays.map(([f, r, c]) => [`${f}:${r}`, c]));
  }

  setActive(active: [number, number, 'latch' | 'press'][]) {
    this.active = new Map(active.map(([g, s, m]) => [`${g}:${s}`, m]));
  }

  setXt(xt: [number, number][]) {
    this.xt = new Set(xt.map(([f, n]) => `${f}:${n}`));
  }

  setLinks(links: LinkStatus[]) {
    this.links = new Map(links.map(l => [l.facility, l]));
  }

  addEvent(e: LogEvent) {
    this.events.push(e);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  // ---- derived counts --------------------------------------------------------------
  activeRouteCount(): number {
    let n = 0;
    for (const r of this.routes) if (r.gain > 0) n++;
    return n;
  }
  closedRelayCount(): number {
    let n = 0;
    for (const c of this.relays.values()) if (c) n++;
    return n;
  }
  connectedLinkCount(): number {
    let n = 0;
    for (const l of this.links.values()) if (l.connected) n++;
    return n;
  }

  /** Ports matching a free-text query (label, mnemonic, overlay, gid). */
  searchPorts(q: string, limit = 200): Port[] {
    const s = q.trim().toLowerCase();
    if (!s) return this.ports.slice(0, limit);
    const num = /^\d+$/.test(s) ? Number(s) : NaN;
    const out: Port[] = [];
    for (const p of this.ports) {
      if (p.gid === num || p.label.toLowerCase().includes(s) || p.mnemonic.toLowerCase().includes(s)
        || (p.overlay && p.overlay.toLowerCase().includes(s))) {
        out.push(p);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  facilityPorts(f: number): Port[] {
    return this.ports.slice(f * this.slice, (f + 1) * this.slice);
  }

  portName(gid: number): string {
    const p = this.port(gid);
    if (!p) return `#${gid}`;
    return p.mnemonic ? `${p.label} ${p.mnemonic}` : p.label;
  }
}
