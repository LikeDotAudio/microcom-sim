// Client for the matrix engine WebSocket (mcom-tui/mcommatrix/server.py). Platform independent: the
// front end injects a WebSocket factory (browser WebSocket or Node 24's global WebSocket).
import type { EpcEntry, ExtKey, PortTuple, ProfileInfo } from '../../matrix/types';

export type { EpcEntry, ExtKey, PortTuple, ProfileInfo };

/** FacilityConfig as JSON (engine get_config): maps are keyed by bus number as a string. */
export interface Cfg {
  size: number;
  mnemonic: Record<string, string>;
  attr: Record<string, number>;
  term: Record<string, string>;
  desc: Record<string, string>;
  overlay: Record<string, string>;
  keypad: string[];
  phantom: string[];
  relay_out: number[];
  relay_mask: string[];
  ifb_bus: number[];
  ifb_pgm: number[];
  ifb_mode: number;
  pgm_limit: number;
  cam: number[];
  cam_flags: number[];
  iso: number[];
  call: number[][];
  epc: EpcEntry[];
  keys: Record<string, number[][]>;
  groups: Record<string, number[]>;
}

export interface Location {
  site?: string; building?: string; floor?: string | number; room?: string; row?: string | number;
  seat?: string | number; x?: number | string; y?: number | string; lat?: number | string; lon?: number | string;
}
export interface Meta { name?: string; role?: string; emoji?: string; location?: Location }
export interface FacMeta { name?: string; site?: string; building?: string; lat?: number | string; lon?: number | string }

/** Minimal WebSocket surface used here (browser and Node 24 global WebSocket both fit). */
export interface WsLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}
export type WsFactory = (url: string) => WsLike;

interface Pending { facility: number; resolve: (c: Cfg) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

export class EngineClient {
  readonly url: string;
  private factory: WsFactory;
  private ws: WsLike | null = null;
  private retry = 0;
  private closed = false;
  private pending: Pending[] = [];
  private listeners = new Set<(what: string) => void>();

  connected = false;
  admin = false;
  profile: ProfileInfo | null = null;
  ports: PortTuple[] = [];
  extKeys: Record<string, ExtKey[]> = {};
  panelModels: Record<string, string> = {};
  meta: Record<string, Meta> = {};
  facMeta: Record<string, FacMeta> = {};
  configured: boolean[] = [];
  lastError = '';

  constructor(url: string, factory: WsFactory) {
    this.url = url;
    this.factory = factory;
  }

  on(fn: (what: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(what: string) { for (const fn of this.listeners) fn(what); }

  connect() {
    this.closed = false;
    let ws: WsLike;
    try {
      ws = this.factory(this.url);
    } catch (e) {
      this.lastError = String(e);
      this.schedule();
      return;
    }
    this.ws = ws;
    ws.onopen = () => { this.retry = 0; };
    ws.onmessage = ev => {
      if (typeof ev.data !== 'string') return;
      let m: Record<string, unknown>;
      try { m = JSON.parse(ev.data); } catch { return; }
      this.handle(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.connected) { this.connected = false; this.emit('status'); }
      for (const p of this.pending.splice(0)) { clearTimeout(p.timer); p.reject(new Error('connection lost')); }
      if (!this.closed) this.schedule();
    };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  }

  private schedule() {
    const delay = Math.min(5000, 300 * 2 ** this.retry++);
    setTimeout(() => { if (!this.closed) this.connect(); }, delay);
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }

  /** Apply one server message (exported for tests). */
  handle(m: Record<string, unknown>) {
    switch (m.t) {
      case 'hello':
        this.admin = !!m.admin;
        break;
      case 'snapshot': {
        const st = m.state as Record<string, unknown>;
        this.profile = st.profile as ProfileInfo;
        this.ports = st.ports as PortTuple[];
        this.extKeys = (st.extKeys ?? {}) as Record<string, ExtKey[]>;
        this.panelModels = (st.panelModels ?? {}) as Record<string, string>;
        this.meta = (st.meta ?? {}) as Record<string, Meta>;
        this.facMeta = (st.facMeta ?? {}) as Record<string, FacMeta>;
        this.configured = ((st.facilities ?? []) as { configured: boolean }[]).map(f => f.configured);
        const was = this.connected;
        this.connected = true;
        this.emit(was ? 'snapshot' : 'status');
        break;
      }
      case 'meta':
        this.meta[String(m.gid)] = m.meta as Meta;
        this.emit('meta');
        break;
      case 'facmeta':
        this.facMeta[String(m.facility)] = m.meta as FacMeta;
        this.emit('meta');
        break;
      case 'cfg': {
        const i = this.pending.findIndex(p => p.facility === m.facility);
        if (i >= 0) {
          const [p] = this.pending.splice(i, 1);
          clearTimeout(p.timer);
          p.resolve(m.cfg as Cfg);
        }
        break;
      }
      case 'error': {
        this.lastError = String(m.message);
        const p = this.pending.shift();
        if (p) { clearTimeout(p.timer); p.reject(new Error(this.lastError)); }
        this.emit('error');
        break;
      }
      default:
        break;
    }
  }

  send(msg: object): boolean {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** getcfg; also serves as a barrier: an 'error' for an earlier request rejects it. */
  getConfig(facility: number, timeoutMs = 8000): Promise<Cfg> {
    return new Promise((resolve, reject) => {
      if (!this.send({ t: 'getcfg', facility })) { reject(new Error('Matrix engine not ON-LINE')); return; }
      const timer = setTimeout(() => {
        const i = this.pending.findIndex(p => p.timer === timer);
        if (i >= 0) this.pending.splice(i, 1);
        reject(new Error('Matrix engine did not answer'));
      }, timeoutMs);
      this.pending.push({ facility, resolve, reject, timer });
    });
  }

  /** Send requests without replies, then a getcfg barrier; resolves with the fresh configuration. */
  async transact(facility: number, msgs: object[]): Promise<Cfg> {
    for (const m of msgs) {
      if (!this.send(m)) throw new Error('Matrix engine not ON-LINE');
    }
    return this.getConfig(facility);
  }

  // ---- lookups --------------------------------------------------------------------------
  get slice(): number { return this.profile?.slice ?? 64; }
  get facilities(): number { return this.profile?.facilities ?? 32; }
  get prefix(): string { return this.profile?.facilityPrefix ?? 'PROD'; }

  fname(f: number): string { return `${this.prefix}${String(f + 1).padStart(2, '0')}`; }
  prodName(f: number): string { return this.facMeta[String(f)]?.name ?? ''; }
  gid(f: number, bus: number): number { return f * this.slice + bus; }
  port(gid: number): PortTuple | undefined { return this.ports[gid - 1]; }
  /** [facility, bus] of a global port. */
  local(gid: number): [number, number] { return [Math.floor((gid - 1) / this.slice), ((gid - 1) % this.slice) + 1]; }
  kind(f: number, bus: number): string { return this.port(this.gid(f, bus))?.[1] ?? ''; }
}
