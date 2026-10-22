// Crosspoint routing: configuration + live key/trigger state -> active routes. Port of
// mcommatrix/routing.py; MODEL marks behaviour the hardware documentation does not pin down.
import type { FacilityConfig } from './config';
import type { Profile } from './profile';

export const TALK_KINDS = new Set(['talk', 'grp', 'call', 'cam', 'iso', 'conf', 'event', 'perm', 'xt', 'ext']);
export const LISTEN_KINDS = new Set(['listen', 'listen-lm']);

export interface Route { src: number; dst: number; kind: string; via: string; gain: number }
export type RouteJson = [number, number, string, number, string];
export const routeJson = (r: Route): RouteJson => [r.src, r.dst, r.kind, Math.round(r.gain * 1000) / 1000, r.via];

export interface ExtKey { label: string; targets: number[]; talk?: boolean; listen?: boolean }
/** live keys: "gid,slot" -> mode */
export type Active = Map<string, 'latch' | 'press'>;
export const akey = (gid: number, slot: number) => `${gid},${slot}`;
export const unkey = (k: string) => k.split(',').map(Number) as [number, number];

const p2 = (n: number) => String(n).padStart(2, '0');

/** Returns [routes "src,dst" -> Route, relays "f,r" -> closed]. */
export function compute(profile: Profile, facilities: FacilityConfig[], active: Active, xt: Set<string>,
  extKeys: Record<number, ExtKey[]>, talentMuted: Set<number> = new Set()): [Map<string, Route>, Map<string, boolean>] {
  const routes = new Map<string, Route>();
  const add = (src: number | null, dst: number | null, kind: string, via: string, gain = 1.0) => {
    if (!src || !dst || src === dst) return;
    const k = `${src},${dst}`;
    const cur = routes.get(k);
    if (!cur || gain > cur.gain || ((cur.kind === 'cpl' || cur.kind === 'pgm') && TALK_KINDS.has(kind))) {
      routes.set(k, { src, dst, kind, via, gain });
    }
  };
  const inhibit: string[] = [];
  const conferences = new Map<string, { f: number; n: number; members: Set<number> }>();
  const eventsOn = new Set<string>();

  // ---- static routes: EPC permanent / external, camera party lines, IFB program feeds -----
  facilities.forEach((cfg, f) => {
    const g = (b: number) => profile.gid(f, b);
    for (const e of cfg.epc) {
      const src = g(e.in), dst = g(e.out), t = e.type, ext = e.ext;
      if (t === 0x40) add(src, dst, 'perm', `${profile.fname(f)} EPC PERM`);
      else if (t === 0x41) inhibit.push(`${src},${dst}`);
      else if (t === 0x42 && xt.has(`${f},${ext}`)) add(src, dst, 'xt', `${profile.fname(f)} EPC XT${p2(ext)}`);
    }
    for (let a = 0; a < 8; a++) {                            // MODEL: CPL = cameras hear each other
      const cams = cfg.cam.slice(a * 12, (a + 1) * 12).filter(c => c).map(g);
      if (cfg.cam_flags[a] & 0x80 && cams.length > 1) {
        for (const s of cams) for (const d of cams) add(s, d, 'cpl', `${profile.fname(f)} CMA${a + 1} CPL`, 0.7);
      }
    }
    for (let i = 0; i < 48; i++) {                           // MODEL: IFB bus carries program
      const bus = cfg.ifb_bus[i], pgm = cfg.ifb_pgm[i];
      if (bus && pgm && bus !== 0xff && pgm !== 0xff) add(g(pgm), g(bus), 'pgm', `${profile.fname(f)} IFB${p2(i + 1)} PGM`);
    }
  });

  // ---- keys --------------------------------------------------------------------------
  for (const k of active.keys()) {
    const [gid, slot] = unkey(k);
    const port = profile.port(gid);
    const f = port.facility, b = port.local;
    const cfg = facilities[f];
    const g = (x: number) => profile.gid(f, x);
    if (slot >= 100) {                                       // matrix-level extended key
      const ek = extKeys[gid] ?? [];
      if (slot - 100 < ek.length) {
        const key = ek[slot - 100];
        for (const t of key.targets) {
          if (key.talk ?? true) add(gid, t, 'ext', `${port.label} ${key.label}`);
          if (key.listen) add(t, gid, 'listen', `${port.label} ${key.label}`);
        }
      }
      continue;
    }
    const keys = cfg.keys[b];
    if (!keys || slot >= keys.length) continue;
    const [code, attr] = keys[slot];
    if (!code || code === 0xff) continue;
    const via = `${port.label} key ${slot + 1}`;
    if (attr & 0x05) {                                       // phantom code
      if (attr === 0xc1) {
        for (const t of (cfg.groups[b] ?? []).slice((code - 1) * 6, code * 6)) if (t) add(gid, g(t), 'grp', `${via} GRP${code}`);
      } else if (attr === 0xc4 && code >= 1 && code <= 12) {
        for (const t of cfg.call[code - 1]) if (t) add(gid, g(t), 'call', `${via} CA${p2(code)}`);
      } else if (attr === 0xc3 && code >= 1 && code <= 8) {
        for (const t of cfg.cam.slice((code - 1) * 12, code * 12)) if (t) add(gid, g(t), 'cam', `${via} CMA${code}`);
      } else if (attr === 0xcb && code >= 1 && code <= 24) {
        add(gid, g(cfg.iso[code - 1]), 'iso', `${via} IS${p2(code)}`);
      } else if (attr === 0xc5) {
        const ck = `${f},${code}`;
        if (!conferences.has(ck)) conferences.set(ck, { f, n: code, members: new Set() });
        conferences.get(ck)!.members.add(gid);
      } else if (attr === 0xc6) {
        eventsOn.add(`${f},${code}`);
      }
      continue;
    }
    const target = g(code);
    if (target === null) continue;
    if (attr & 0x40) add(gid, target, 'talk', via);
    if (attr & 0x80) add(target, gid, attr & 0x20 ? 'listen-lm' : 'listen', via);
  }

  // ---- conferences and pegboard events ---------------------------------------------------
  for (const { f, n, members } of conferences.values()) {    // MODEL: party line among members
    for (const s of members) for (const d of members) add(s, d, 'conf', `${profile.fname(f)} CNF${n}`);
  }
  facilities.forEach((cfg, f) => {
    for (const e of cfg.epc) {
      const t = e.type;
      if ((t & 0x06) === 0x04 && eventsOn.has(`${f},${e.ext}`)) {
        const src = profile.gid(f, e.in), dst = profile.gid(f, e.out);
        const via = `${profile.fname(f)} EPC EV${p2(e.ext)}`;
        if (t & 0x40) add(src, dst, 'event', via);
        if (t & 0x80) add(dst, src, t & 0x20 ? 'listen-lm' : 'listen', via);
      }
    }
  });

  // ---- post-processing: L/M muting, IFB interrupt, inhibits ---------------------------------
  const talkers = new Set<number>(), talkedTo = new Set<number>();
  for (const r of routes.values()) if (TALK_KINDS.has(r.kind)) { talkers.add(r.src); talkedTo.add(r.dst); }
  for (const r of routes.values()) {
    if (r.kind === 'listen-lm' && talkers.has(r.dst)) r.gain = 0.0;   // listen/mute: muted while talking
    if (r.kind === 'pgm' && talkedTo.has(r.dst)) r.gain = 0.1;        // MODEL: IFB interrupt dims program
  }
  for (const k of inhibit) routes.delete(k);

  // ---- talent microphones (IFB/Mic ports) are listen sources only; cough / MIC OFF mutes them --------
  for (const [k, r] of [...routes]) {
    if (profile.port(r.src).kind !== 'ifb') continue;
    if (!LISTEN_KINDS.has(r.kind)) routes.delete(k);
    else if (talentMuted.has(r.src)) r.gain = 0.0;
  }

  // ---- relays: close when a selected input talks to the relay's output bus ----------------
  const relays = new Map<string, boolean>();
  facilities.forEach((cfg, f) => {
    for (let r = 0; r < 12; r++) {
      const out = cfg.relay_out[r];
      if (!out || out === 0xff) continue;
      const dst = profile.gid(f, out);
      let closed = false;
      for (const rt of routes.values()) {
        if (rt.dst === dst && TALK_KINDS.has(rt.kind) && rt.gain > 0) {
          const sp = profile.port(rt.src);
          if (sp.facility === f && cfg.maskBit(r, sp.local)) { closed = true; break; }
        }
      }
      relays.set(`${f},${r + 1}`, closed);
    }
  });
  return [routes, relays];
}
