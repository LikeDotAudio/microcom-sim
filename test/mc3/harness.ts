// Test harness: an in-memory matrix engine speaking the WebSocket protocol, and helpers to drive the app.
import { App } from '../../src/mc3/core/app';
import type { Cfg, WsLike } from '../../src/mc3/core/engine';
import { parseKeys } from '../../src/mc3/core/keys';
import { emptyCfg } from '../../src/mc3/core/model';

const ROLES = ['DIR', 'PRD', 'TD', 'AUD', 'CAM1', 'CAM2', 'CAM3', 'CAM4', 'CAM5', 'CAM6', 'CAM7', 'CAM8',
  'FM1', 'FM2', 'GFX', 'VTR', 'LD', 'EVS', 'SHD', 'TX', 'ENG', 'RF', 'CAP', 'STG'];

function demoCfg(f: number): Cfg {
  const c = emptyCfg();
  c.size = 96;
  for (let b = 1; b <= 64; b++) {
    const mn = b <= 24 ? ROLES[b - 1] : b <= 32 ? `IF${String(b - 24).padStart(2, '0')}` : b <= 48 ? `R${String(b - 32).padStart(2, '0')}` : `U${String(b - 48).padStart(2, '0')}`;
    c.mnemonic[b] = mn.padEnd(4);
    c.attr[b] = 0xc0 | (b > 24 && b <= 32 ? 2 : 0);
    c.desc[b] = `PROD${String(f + 1).padStart(2, '0')} port ${b}`;
    c.term[b] = b <= 24 ? (b === 1 ? '6' : b === 3 ? '2' : '1') : '0';
  }
  const keys = Array.from({ length: 40 }, () => [0, 0]);
  keys[0] = [5, 0xc0]; keys[1] = [1, 0xc1]; keys[2] = [3, 0x40];
  c.keys['1'] = keys;
  c.groups['1'] = [5, 6, 7, 0, 0, 0, ...new Array(18).fill(0)];
  c.keypad = ['$0..', '$1..', '$2..', ...new Array(12).fill('    '), 'IF..', '    ', '    '];
  return c;
}

export class FakeEngine {
  cfg: Cfg[] = Array.from({ length: 32 }, (_, f) => demoCfg(f));
  extKeys: Record<string, { label: string; targets: number[]; talk: boolean; listen: boolean }[]> = {
    '1': [{ label: 'P02', targets: [65], talk: true, listen: true }],
  };
  panelModels: Record<string, string> = { '2': 'M7832' };
  meta: Record<string, Record<string, unknown>> = { '1': { name: 'Ava Adams', role: 'Director', emoji: '🎬', location: { room: 'Control Room 1', row: 1, seat: 1 } } };
  facMeta: Record<string, Record<string, unknown>> = { '0': { name: 'Hockey Night', site: 'Toronto' }, '29': { name: 'Science Now', site: 'Calgary' } };
  received: Record<string, unknown>[] = [];
  sockets: FakeWs[] = [];

  snapshot() {
    const ports: unknown[] = [];
    for (let f = 0; f < 32; f++) {
      for (let b = 1; b <= 64; b++) {
        const kind = b <= 24 ? 'panel' : b <= 32 ? 'ifb' : b <= 48 ? 'remote' : 'util';
        const c = this.cfg[f];
        ports.push([f * 64 + b, kind, `PROD${String(f + 1).padStart(2, '0')} X${b}`, c.mnemonic[b] ?? '', c.overlay[b] ?? '', c.term[b] ?? '', 0]);
      }
    }
    return {
      profile: { name: 'test', facilityPrefix: 'PROD', ports: 2048, slice: 64, facilities: 32, sections: [], mcomSize: 96, tcpBase: 7000 },
      ports, facilities: this.cfg.map((c, id) => ({ id, configured: c.size > 0 })), links: [], routes: [], relays: [], active: [],
      xt: [], events: [], extKeys: this.extKeys, panelModels: this.panelModels, talent: {}, meta: this.meta, facMeta: this.facMeta,
    };
  }

  handle(ws: FakeWs, m: Record<string, unknown>) {
    this.received.push(m);
    const reply = (o: unknown) => queueMicrotask(() => ws.onmessage?.({ data: JSON.stringify(o) }));
    const f = Number(m.facility);
    switch (m.t) {
      case 'getcfg': reply({ t: 'cfg', facility: f, cfg: JSON.parse(JSON.stringify(this.cfg[f])) }); break;
      case 'setcfg': {
        const c = this.cfg[f] as unknown as Record<string, unknown>;
        for (const [k, v] of Object.entries(m.changes as Record<string, unknown>)) {
          if (!(k in c)) { reply({ t: 'error', message: `unknown configuration field '${k}'` }); return; }
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            const map = c[k] as Record<string, unknown>;
            for (const [kk, vv] of Object.entries(v)) { if (vv === null) delete map[kk]; else map[kk] = vv; }
          } else c[k] = v;
        }
        break;
      }
      case 'extkeys': if ((m.keys as unknown[]).length) this.extKeys[String(m.gid)] = m.keys as never; else delete this.extKeys[String(m.gid)]; break;
      case 'panelmodel': if (m.model) this.panelModels[String(m.gid)] = String(m.model); else delete this.panelModels[String(m.gid)]; break;
      case 'meta': this.meta[String(m.gid)] = { ...(this.meta[String(m.gid)] ?? {}), ...(m.meta as object) }; break;
      case 'facmeta': this.facMeta[String(m.facility)] = { ...(this.facMeta[String(m.facility)] ?? {}), ...(m.meta as object) }; break;
      default: break;
    }
  }

  factory = (url: string): WsLike => {
    const ws = new FakeWs(this, url);
    this.sockets.push(ws);
    return ws;
  };
}

export class FakeWs implements WsLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  readonly eng: FakeEngine;
  readonly url: string;

  constructor(eng: FakeEngine, url: string) {
    this.eng = eng;
    this.url = url;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.({});
      this.onmessage?.({ data: JSON.stringify({ t: 'hello', admin: true, gid: null }) });
      this.onmessage?.({ data: JSON.stringify({ t: 'snapshot', state: eng.snapshot() }) });
    }, 0);
  }

  send(data: string) { this.eng.handle(this, JSON.parse(data)); }
  close() { this.readyState = 3; this.onclose?.({}); }
}

const tick = () => new Promise(r => setTimeout(r, 0));

/** Wait until the app sits in a key wait with nothing queued. */
export async function settle(app: App) {
  let stable = 0;
  for (let i = 0; i < 2000 && stable < 3; i++) {
    await tick();
    stable = app.rt.blocked ? stable + 1 : 0;
  }
}

export async function startApp(production = 29) {
  const eng = new FakeEngine();
  const printed: [string, string][] = [];
  const app = new App({ url: 'ws://test/ws', factory: eng.factory, server: '127.0.0.1:8048', production,
    host: { print: (n, t) => { printed.push([n, t]); return n; } } });
  app.rt.timeScale = 0.001;
  app.rt.now = () => new Date(2026, 9, 21, 19, 46);
  const done = app.run();
  await settle(app);
  return { app, eng, printed, done };
}

/** Type a key script ({F10}, {DOWN}, text ...) one key at a time, settling after each. */
export async function type(app: App, script: string) {
  for (const k of parseKeys(script)) {
    app.rt.push(k);
    await settle(app);
  }
}

export const screen = (app: App) => app.rt.screen.text();
