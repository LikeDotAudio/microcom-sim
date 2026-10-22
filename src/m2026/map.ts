// Map screen in the old speaker grille — "here, there, everywhere": this room (rows and seats), the
// production's floor plan (rooms packed side by side), or the world (orthographic globe / flat map) with
// every site. Stations are plotted with their emoji and live talk/listen state relative to this station.
import { r2, svg } from '../matrix/panelSvg';
import type { Store } from '../matrix/store';
import { LISTEN_KINDS, TALK_KINDS, type Location } from '../matrix/types';
import {
  bearingDeg, bounds, clampLat, clockDir, compass, distanceKm, equirect, fmtKm, fmtM, greatCircle, nextInDirection,
  ortho, packRooms, planBearing, planDistance, wrapLon, type Dir, type LatLon, type XY,
} from './geo';
import { WORLD } from './world';

export type Level = 'here' | 'there' | 'everywhere';
export type MapType = 'globe' | 'world' | 'building' | 'room';
export type Rel = 'in' | 'out' | 'both' | 'listen' | 'busy' | null;

export const levelOf = (t: MapType): Level => (t === 'room' ? 'here' : t === 'building' ? 'there' : 'everywhere');

interface Pt {
  id: string; kind: 'site' | 'station' | 'remote';
  label: string; emoji: string; sub: string;
  gid?: number; facs?: number[]; ll?: LatLon; plan?: XY; room?: string; row?: number;
  self?: boolean; x: number; y: number; visible: boolean; rel: Rel; near?: boolean;
}

const MAXZ: Record<MapType, number> = { globe: 8, world: 10, building: 4, room: 3 };

export class StationMap {
  type: MapType = 'room';
  everywhere: 'globe' | 'world' = 'globe';
  zoom = 1;
  center: LatLon = { lat: 30, lon: -60 };
  sel: string | null = null;
  room: string | null = null;
  facility: number;
  onPick: ((gid: number) => void) | null = null;
  onFacility: ((f: number) => void) | null = null;
  private el: SVGSVGElement | null = null;
  private w = 122; private h = 95;
  private pts: Pt[] = [];
  private anim = 0;

  constructor(private store: Store, private self: number, facility: number, start: Level = 'here') {
    this.facility = facility;
    const me = this.loc(self);
    if (me?.lat !== undefined && me.lon !== undefined) this.center = { lat: clampLat(me.lat), lon: me.lon };
    this.type = start === 'here' ? 'room' : start === 'there' ? 'building' : this.everywhere;
    if (start === 'here' && !me?.room) this.type = 'building';
  }

  get level(): Level { return levelOf(this.type); }

  mount(el: SVGSVGElement) {
    this.el = el;
    const vb = el.viewBox.baseVal;
    this.w = vb.width; this.h = vb.height;
    el.addEventListener('pointerdown', e => this.pointer(e));
    el.addEventListener('wheel', e => { e.preventDefault(); this.act(e.deltaY < 0 ? 'zin' : 'zout'); }, { passive: false });
    this.render();
  }

  dispose() { cancelAnimationFrame(this.anim); }

  private loc(gid: number): Location | undefined { return this.store.personOf(gid).location; }

  setFacility(f: number) {
    if (f === this.facility) return;
    this.facility = f;
    this.room = null;
    this.sel = null;
    const fm = this.store.facMeta.get(f);
    if (fm?.lat !== undefined && fm.lon !== undefined && this.level === 'everywhere') this.flyTo({ lat: fm.lat, lon: fm.lon });
    this.render();
  }

  setLevel(l: Level) {
    const t: MapType = l === 'here' ? 'room' : l === 'there' ? 'building' : this.everywhere;
    if (t === this.type) return;
    this.type = t;
    this.zoom = 1;
    this.render();
  }

  cycleType() {
    const order: MapType[] = ['globe', 'world', 'building', 'room'];
    this.type = order[(order.indexOf(this.type) + 1) % order.length];
    if (this.type === 'globe' || this.type === 'world') this.everywhere = this.type;
    this.zoom = 1;
    this.render();
  }

  /** Keypad / keyboard actions. */
  act(a: string) {
    switch (a) {
      case 'up': case 'down': case 'left': case 'right': this.move(a); break;
      case 'ok': this.enter(); break;
      case 'zin':
        if (this.zoom * 1.5 <= MAXZ[this.type] + 1e-6) { this.zoom *= 1.5; this.recentre(); this.render(); } else this.enter();
        break;
      case 'zout':
        if (this.zoom / 1.5 >= 1 - 1e-6) { this.zoom /= 1.5; this.render(); }
        else if (this.type === 'room') this.setLevel('there');
        else if (this.type === 'building') this.setLevel('everywhere');
        break;
      case 'here': this.room = null; this.setLevel('here'); this.selectSelf(); break;
      case 'there': this.setLevel('there'); break;
      case 'every': this.setLevel('everywhere'); break;
      case 'me': this.selectSelf(); break;
      case 'map': this.cycleType(); break;
    }
  }

  private selectSelf() {
    const sf = this.store.facilityOf(this.self);
    if (this.level !== 'everywhere' && sf !== this.facility) { this.onFacility?.(sf); this.setFacility(sf); }
    this.room = null;
    this.build();
    const me = this.pts.find(p => p.self);
    this.sel = me?.id ?? null;
    const l = this.loc(this.self);
    if (this.level === 'everywhere' && l?.lat !== undefined && l.lon !== undefined) this.flyTo({ lat: l.lat, lon: l.lon });
    this.render();
  }

  private move(d: Dir) {
    this.build();
    const vis = this.pts.filter(p => p.visible);
    const from = vis.findIndex(p => p.id === this.sel);
    const i = nextInDirection(vis, from, d);
    if (i >= 0 && i !== from) {
      this.sel = vis[i].id;
      this.recentre();
    } else if (this.type === 'globe' || this.type === 'world') {
      const step = 25 / this.zoom;
      const c = this.center;
      this.center = d === 'left' ? { lat: c.lat, lon: wrapLon(c.lon - step) } : d === 'right' ? { lat: c.lat, lon: wrapLon(c.lon + step) }
        : d === 'up' ? { lat: clampLat(Math.min(80, c.lat + step)), lon: c.lon } : { lat: clampLat(Math.max(-80, c.lat - step)), lon: c.lon };
    }
    this.render();
  }

  private recentre() {
    const p = this.pts.find(x => x.id === this.sel);
    if (p?.ll && (this.type === 'globe' || this.type === 'world')) this.flyTo(p.ll);
  }

  /** Drill in: site → its production's floor; station on the floor → its room; in a room → pick. */
  private enter() {
    this.build();
    const p = this.pts.find(x => x.id === this.sel);
    if (!p) { if (this.level === 'everywhere') this.setLevel('there'); else if (this.level === 'there') this.setLevel('here'); return; }
    if (p.kind === 'site' && p.facs?.length) {
      const f = p.facs.includes(this.facility) ? this.facility : p.facs[0];
      if (f !== this.facility) { this.onFacility?.(f); this.setFacility(f); }
      this.setLevel('there');
    } else if (p.kind === 'station' && this.type === 'building' && p.room) {
      this.room = p.room;
      this.setLevel('here');
      this.sel = p.id;
      this.render();
    } else if (p.gid) {
      this.onPick?.(p.gid);
    }
  }

  private flyTo(target: LatLon) {
    cancelAnimationFrame(this.anim);
    const from = { ...this.center };
    const dLon = wrapLon(target.lon - from.lon);
    const t0 = performance.now();
    const stepFn = (now: number) => {
      const k = Math.min(1, (now - t0) / 350);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      this.center = { lat: clampLat(from.lat + (target.lat - from.lat) * e), lon: wrapLon(from.lon + dLon * e) };
      this.render();
      if (k < 1) this.anim = requestAnimationFrame(stepFn);
    };
    this.anim = requestAnimationFrame(stepFn);
  }

  // ---- relations -------------------------------------------------------------------------------------
  rel(g: number): Rel {
    const s = this.store, me = this.self;
    if (g === me) return s.getTally(me).talking ? 'out' : null;
    const a = s.route(g, me), b = s.route(me, g);
    const into = !!a && a.gain > 0 && TALK_KINDS.has(a.kind);
    const out = !!b && b.gain > 0 && TALK_KINDS.has(b.kind);
    if (into && out) return 'both';
    if (into) return 'in';
    if (out) return 'out';
    if (a && a.gain > 0 && (LISTEN_KINDS.has(a.kind) || a.kind === 'pgm')) return 'listen';
    return s.getTally(g).talking ? 'busy' : null;
  }

  private nearSet(): Map<number, number> {
    const m = new Map<number, number>();
    for (const [a, b, db] of this.store.near) {
      if (a === this.self) m.set(b, db); else if (b === this.self) m.set(a, db);
    }
    return m;
  }

  // ---- model -----------------------------------------------------------------------------------------
  private stationsOf(f: number) {
    return this.store.facilityPorts(f).filter(p => this.store.meta.has(p.gid));
  }

  private stationPt(gid: number, near: Map<number, number>): Omit<Pt, 'x' | 'y' | 'visible'> {
    const m = this.store.personOf(gid);
    const p = this.store.port(gid);
    const l = m.location ?? {};
    const where = [l.room, l.row !== undefined ? `row ${l.row}` : '', l.seat !== undefined ? `seat ${l.seat}` : ''].filter(Boolean).join(' ');
    return {
      id: `g${gid}`, kind: 'station', gid, label: m.name ?? p?.mnemonic.trim() ?? `#${gid}`, emoji: m.emoji ?? '•',
      sub: [m.role, p?.mnemonic.trim(), where].filter(Boolean).join(' · '), room: l.room, row: l.row,
      ll: l.lat !== undefined && l.lon !== undefined ? { lat: l.lat, lon: l.lon } : undefined,
      self: gid === this.self, rel: this.rel(gid), near: near.has(gid),
    };
  }

  /** Points of the current view, projected to map coordinates. */
  private build() {
    const W = this.w, H = this.h;
    const py0 = 7, ph = H - py0 - 12;
    const near = this.nearSet();
    const pts: Pt[] = [];
    if (this.level === 'everywhere') {
      const sites = new Map<string, { ll: LatLon; facs: number[] }>();
      for (const [f, fm] of this.store.facMeta) {
        if (fm.lat === undefined || fm.lon === undefined) continue;
        const k = fm.site ?? `${fm.lat},${fm.lon}`;
        const s = sites.get(k) ?? sites.set(k, { ll: { lat: fm.lat, lon: fm.lon }, facs: [] }).get(k)!;
        s.facs.push(f);
      }
      // live: which productions talk with this station
      const live = new Map<number, Rel>();
      for (const r of [...(this.store.byDst.get(this.self) ?? []), ...(this.store.bySrc.get(this.self) ?? [])]) {
        if (r.gain <= 0 || r.src === r.dst) continue;
        const other = r.src === this.self ? r.dst : r.src;
        const rl = this.rel(other);
        if (rl && rl !== 'busy') live.set(this.store.facilityOf(other), rl);
      }
      const selfFac = this.store.facilityOf(this.self);
      const selfSite = this.store.facMeta.get(selfFac)?.site;
      for (const [name, s] of sites) {
        const rels = s.facs.map(f => live.get(f)).filter(Boolean) as Rel[];
        pts.push({ id: `s${name}`, kind: 'site', label: name, emoji: '📍', ll: s.ll, facs: s.facs,
          sub: s.facs.map(f => this.store.facMeta.get(f)?.name ?? '').filter(Boolean).join(', '),
          self: name === selfSite, rel: rels.includes('in') || rels.includes('both') ? 'in' : rels[0] ?? null, x: 0, y: 0, visible: true });
      }
      for (const p of this.store.facilityPorts(this.facility)) {
        if (p.kind !== 'remote') continue;
        const sp = this.stationPt(p.gid, near);
        if (sp.ll) pts.push({ ...sp, kind: 'remote', x: 0, y: 0, visible: true });
      }
      const cx = W / 2, cy = py0 + ph / 2;
      for (const p of pts) {
        const q = this.type === 'globe' ? ortho(p.ll!, this.center, this.globeR(), cx, cy)
          : equirect(p.ll!, this.center, this.worldS(), cx, cy);
        Object.assign(p, { x: q.x, y: q.y, visible: q.visible && q.x > -2 && q.x < W + 2 && q.y > 0 && q.y < H });
      }
    } else {
      const ports = this.stationsOf(this.facility).filter(p => {
        const l = this.loc(p.gid);
        return l?.room && l.x !== undefined && l.y !== undefined;
      });
      const byRoom = new Map<string, number[]>();
      for (const p of ports) {
        const r = this.loc(p.gid)!.room!;
        (byRoom.get(r) ?? byRoom.set(r, []).get(r)!).push(p.gid);
      }
      const names = [...byRoom.keys()].sort((a, b) => roomRank(a) - roomRank(b) || a.localeCompare(b));
      if (this.type === 'room') {
        const mine = this.loc(this.self)?.room;
        const room = this.room && byRoom.has(this.room) ? this.room : mine && byRoom.has(mine) ? mine : names[0];
        this.room = room ?? null;
        for (const g of byRoom.get(room ?? '') ?? []) {
          const l = this.loc(g)!;
          pts.push({ ...this.stationPt(g, near), plan: { x: l.x!, y: l.y! }, x: 0, y: 0, visible: true });
        }
      } else {
        const boxes = packRooms(names.map(n => ({ name: n, pts: byRoom.get(n)!.map(g => ({ x: this.loc(g)!.x!, y: this.loc(g)!.y! })) })));
        this.boxes = boxes;
        for (const b of boxes) {
          for (const g of byRoom.get(b.name)!) {
            const l = this.loc(g)!;
            pts.push({ ...this.stationPt(g, near), plan: { x: b.ox + l.x!, y: b.oy + l.y! }, x: 0, y: 0, visible: true });
          }
        }
      }
      // fit plan → screen
      const area = this.type === 'building' && this.boxes.length
        ? this.boxes.flatMap(b => [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }])
        : pts.map(p => p.plan!).concat(pts.length ? [] : [{ x: 0, y: 0 }]);
      const bb = bounds(area, 4);
      const pad = this.type === 'room' ? 1.2 : 0.3;
      const scale = Math.min(W / (bb.w + 2 * pad), ph / (bb.h + 2 * pad)) * this.zoom;
      const focus = this.zoom > 1 ? pts.find(p => p.id === this.sel)?.plan : undefined;
      const fx = focus?.x ?? bb.x + bb.w / 2, fy = focus?.y ?? bb.y + bb.h / 2;
      this.planTx = { scale, ox: W / 2 - fx * scale, oy: py0 + ph / 2 - fy * scale };
      for (const p of pts) {
        p.x = this.planTx.ox + p.plan!.x * scale;
        p.y = this.planTx.oy + p.plan!.y * scale;
        p.visible = p.x > -1 && p.x < W + 1 && p.y > py0 - 1 && p.y < H - 11;
      }
    }
    this.pts = pts;
    if (this.sel && !pts.some(p => p.id === this.sel)) this.sel = null;
  }

  private boxes: ReturnType<typeof packRooms> = [];
  private planTx = { scale: 1, ox: 0, oy: 0 };

  private globeR() { return (Math.min(this.w, this.h - 19) / 2) * 0.94 * this.zoom; }
  private worldS() { return (this.w / 360) * this.zoom; }

  // ---- interaction ---------------------------------------------------------------------------------
  private pointer(e: PointerEvent) {
    const t = (e.target as Element).closest('[data-act],[data-pt]');
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    const act = t.getAttribute('data-act');
    if (act) { this.act(act); return; }
    const id = t.getAttribute('data-pt')!;
    if (this.sel === id) this.enter(); else { this.sel = id; this.recentre(); this.render(); }
  }

  // ---- drawing -------------------------------------------------------------------------------------
  render() {
    const el = this.el;
    if (!el) return;
    this.build();
    const W = this.w, H = this.h;
    const kids: SVGElement[] = [svg('rect', { x: 0, y: 0, width: W, height: H, class: 'm26-map-bg' })];
    if (this.type === 'globe') kids.push(...this.drawGlobe());
    else if (this.type === 'world') kids.push(...this.drawWorld());
    else kids.push(...this.drawPlan());
    // talk arcs to live sites (everywhere)
    if (this.level === 'everywhere') kids.push(...this.drawArcs());
    // markers
    const selP = this.pts.find(p => p.id === this.sel);
    const me = this.pts.find(p => p.self);
    const plan = this.level !== 'everywhere';
    if (plan && me) {
      for (const p of this.pts) {
        if (p.near && p.visible && me.visible) kids.push(svg('line', { x1: r2(me.x), y1: r2(me.y), x2: r2(p.x), y2: r2(p.y), class: 'm26-nearline' }));
      }
    }
    const order = [...this.pts].sort((a, b) => Number(!!a.rel) - Number(!!b.rel) || Number(!!a.self) - Number(!!b.self));
    for (const p of order) {
      if (!p.visible) continue;
      const cls = `m26-pt k-${p.kind}${p.self ? ' self' : ''}${p.rel ? ` r-${p.rel}` : ''}${p.near ? ' near' : ''}${p.id === this.sel ? ' sel' : ''}`;
      const g = svg('g', { class: cls, 'data-pt': p.id });
      const r = p.kind === 'site' ? 1.9 : p.kind === 'remote' ? 1.2 : plan ? 2.6 : 1.5;
      if (p.rel === 'in' || p.rel === 'both') g.append(svg('circle', { cx: r2(p.x), cy: r2(p.y), r: r + 1.6, class: 'm26-pulse' }));
      if (p.near) g.append(svg('circle', { cx: r2(p.x), cy: r2(p.y), r: r + 1.1, class: 'm26-nearring' }));
      g.append(svg('circle', { cx: r2(p.x), cy: r2(p.y), r: r + 2.5, class: 'm26-hit' }),
        svg('circle', { cx: r2(p.x), cy: r2(p.y), r, class: 'm26-dot' }));
      if (plan) g.append(svg('text', { x: r2(p.x), y: r2(p.y + 1.1), class: 'm26-pt-emoji', 'text-anchor': 'middle' }, p.emoji));
      const showLabel = p.kind === 'site' || p.self || (p.rel && p.rel !== 'busy') || p.id === this.sel || this.type === 'room';
      if (showLabel) {
        const lbl = p.self && p.kind !== 'site' ? 'YOU' : p.kind === 'site' ? p.label : p.label.split(' ')[0];
        g.append(svg('text', { x: r2(p.x), y: r2(p.y + r + 3), class: 'm26-pt-t', 'text-anchor': 'middle' }, lbl));
      }
      kids.push(g);
    }
    if (selP?.visible) kids.push(svg('circle', { cx: r2(selP.x), cy: r2(selP.y), r: plan ? 4.6 : 3.4, class: 'm26-selring' }));
    kids.push(...this.drawChrome(selP ?? null));
    el.replaceChildren(...kids);
  }

  private drawGlobe(): SVGElement[] {
    const W = this.w, H = this.h;
    const cx = W / 2, cy = 7 + (H - 19) / 2, R = this.globeR();
    const c = this.center;
    const out: SVGElement[] = [svg('circle', { cx: r2(cx), cy: r2(cy), r: r2(R), class: 'm26-sea' })];
    const runs = (pts: LatLon[]) => {
      const segs: string[] = [];
      let cur: string[] = [];
      for (const p of pts) {
        const q = ortho(p, c, R, cx, cy);
        if (q.visible) cur.push(`${r2(q.x)},${r2(q.y)}`);
        else if (cur.length) { segs.push(cur.join(' ')); cur = []; }
      }
      if (cur.length) segs.push(cur.join(' '));
      return segs.filter(s => s.includes(' '));
    };
    let grat = '';
    for (let lat = -60; lat <= 60; lat += 30) for (const s of runs(Array.from({ length: 73 }, (_, i) => ({ lat, lon: -180 + i * 5 })))) grat += `M ${s} `;
    for (let lon = -180; lon < 180; lon += 30) for (const s of runs(Array.from({ length: 35 }, (_, i) => ({ lat: -85 + i * 5, lon })))) grat += `M ${s} `;
    out.push(svg('path', { d: grat, class: 'm26-grat' }));
    let land = '';
    for (const ring of WORLD) {
      const q = ring.map(([lon, lat]) => ortho({ lat, lon }, c, R, cx, cy));
      if (!q.some(p => p.visible)) continue;
      land += `M ${q.map(p => `${r2(p.x)},${r2(p.y)}`).join(' L ')} Z `;
    }
    out.push(svg('path', { d: land, class: 'm26-land' }),
      svg('circle', { cx: r2(cx), cy: r2(cy), r: r2(R), class: 'm26-limb' }));
    return out;
  }

  private drawWorld(): SVGElement[] {
    const W = this.w, H = this.h;
    const cx = W / 2, cy = 7 + (H - 19) / 2, s = this.worldS();
    const c = this.center;
    const out: SVGElement[] = [svg('rect', { x: 0, y: 0, width: W, height: H, class: 'm26-sea-flat' })];
    let grat = '';
    for (let lat = -60; lat <= 60; lat += 30) grat += `M 0 ${r2(cy - (lat - c.lat) * s)} H ${W} `;
    for (let lon = -180; lon < 180; lon += 30) { const x = cx + wrapLon(lon - c.lon) * s; grat += `M ${r2(x)} 0 V ${H} `; }
    out.push(svg('path', { d: grat, class: 'm26-grat' }));
    let land = '';
    for (const ring of WORLD) {
      for (const k of [-1, 0, 1]) {
        const xs = ring.map(([lon]) => cx + (lon - c.lon + 360 * k) * s);
        if (Math.max(...xs) < 0 || Math.min(...xs) > W) continue;
        land += `M ${ring.map(([, lat], i) => `${r2(xs[i])},${r2(cy - (lat - c.lat) * s)}`).join(' L ')} Z `;
      }
    }
    out.push(svg('path', { d: land, class: 'm26-land' }));
    return out;
  }

  private drawArcs(): SVGElement[] {
    const me = this.pts.find(p => p.self && p.kind === 'site');
    const out: SVGElement[] = [];
    if (!me?.ll) return out;
    const W = this.w, H = this.h;
    const cx = W / 2, cy = 7 + (H - 19) / 2;
    for (const p of this.pts) {
      if (p === me || !p.ll || !p.rel || p.rel === 'busy') continue;
      let d = '', pen = false, lastX = 0;
      for (const ll of greatCircle(me.ll, p.ll, 32)) {
        const q = this.type === 'globe' ? ortho(ll, this.center, this.globeR(), cx, cy) : equirect(ll, this.center, this.worldS(), cx, cy);
        if (!q.visible) { pen = false; continue; }
        const jump = this.type === 'world' && pen && Math.abs(q.x - lastX) > W / 2;   // crossed the map edge
        d += `${pen && !jump ? 'L' : 'M'} ${r2(q.x)} ${r2(q.y)} `;
        pen = true; lastX = q.x;
      }
      if (d) out.push(svg('path', { d, class: `m26-arc r-${p.rel}` }));
    }
    return out;
  }

  private drawPlan(): SVGElement[] {
    const out: SVGElement[] = [svg('rect', { x: 0, y: 0, width: this.w, height: this.h, class: 'm26-floor' })];
    const { scale, ox, oy } = this.planTx;
    if (this.type === 'building') {
      for (const b of this.boxes) {
        out.push(svg('rect', { x: r2(ox + b.x * scale), y: r2(oy + b.y * scale), width: r2(b.w * scale), height: r2(b.h * scale), rx: 0.8, class: 'm26-room' }),
          svg('text', { x: r2(ox + b.x * scale + 1), y: r2(oy + b.y * scale + 3), class: 'm26-room-t' }, b.name.toUpperCase()));
      }
    } else {
      // room view: walls around the plotted area, row bands; this station's row highlighted
      const ps = this.pts.map(p => ({ x: p.x, y: p.y }));
      if (ps.length) {
        const bb = bounds(ps, 6);
        out.push(svg('rect', { x: r2(bb.x - 9), y: r2(bb.y - 8), width: r2(bb.w + 16), height: r2(bb.h + 13), rx: 1, class: 'm26-room' }),
          svg('text', { x: r2(bb.x + bb.w / 2), y: r2(bb.y - 5.2), class: 'm26-room-t', 'text-anchor': 'middle' }, '▲ FRONT'));
        const myRow = this.loc(this.self)?.room === this.room ? this.loc(this.self)?.row : undefined;
        const rows = new Map<number, number[]>();
        for (const p of this.pts) if (p.row !== undefined) (rows.get(p.row) ?? rows.set(p.row, []).get(p.row)!).push(p.y);
        for (const [row, ys] of rows) {
          const y = ys.reduce((a, b) => a + b, 0) / ys.length;
          out.push(svg('rect', { x: r2(bb.x - 8), y: r2(y - 3.6), width: r2(bb.w + 14), height: 7.2, rx: 1, class: `m26-row-band${row === myRow ? ' mine' : ''}` }),
            svg('text', { x: r2(bb.x - 7.6), y: r2(y + 0.7), class: 'm26-row-l' }, `R${row}`));
        }
      }
    }
    return out;
  }

  /** Header (level chips, map type) and the info lines for the selection, relative to this station. */
  private drawChrome(sel: Pt | null): SVGElement[] {
    const W = this.w, H = this.h;
    const out: SVGElement[] = [svg('rect', { x: 0, y: 0, width: W, height: 6.2, class: 'm26-map-head' })];
    const chips: [Level, string, string][] = [['here', 'HERE', 'here'], ['there', 'THERE', 'there'], ['everywhere', 'EVERYWHERE', 'every']];
    let x = 1.2;
    for (const [lvl, txt, act] of chips) {
      const w = txt.length * 1.62 + 2.2;
      out.push(svg('g', { 'data-act': act, class: `m26-chip${this.level === lvl ? ' on' : ''}` },
        svg('rect', { x: r2(x), y: 1, width: r2(w), height: 4.4, rx: 0.8 }),
        svg('text', { x: r2(x + w / 2), y: 4.2, 'text-anchor': 'middle' }, txt)));
      x += w + 1;
    }
    const tname = { globe: 'GLOBE', world: 'WORLD MAP', building: 'FLOOR PLAN', room: (this.room ?? 'ROOM').toUpperCase() }[this.type];
    out.push(svg('g', { 'data-act': 'map', class: 'm26-chip type' },
      svg('text', { x: W - 1.2, y: 4.2, 'text-anchor': 'end' }, `${tname} ⟳`)));
    // info
    out.push(svg('rect', { x: 0, y: H - 11.5, width: W, height: 11.5, class: 'm26-map-info' }));
    const lines = this.describe(sel);
    out.push(svg('text', { x: 1.5, y: H - 6.8, class: 'm26-info1' }, clip(lines[0], 62)),
      svg('text', { x: 1.5, y: H - 2, class: `m26-info2${sel?.rel ? ` r-${sel.rel}` : ''}` }, clip(lines[1], 70)));
    return out;
  }

  private describe(sel: Pt | null): [string, string] {
    const near = this.nearSet();
    const names = (gs: number[]) => gs.map(g => (this.store.personOf(g).name ?? `#${g}`).split(' ')[0]).join(', ');
    if (!sel) {
      const fm = this.store.facMeta.get(this.facility);
      if (this.level === 'everywhere') return [`${this.pts.filter(p => p.kind === 'site').length} sites · ← → ▲ ▼ to move, OK to open`, 'ZM+/ZM− zoom · MAP changes the map · ME = you'];
      const myRow = this.loc(this.self);
      const rowMates = this.pts.filter(p => !p.self && p.room === myRow?.room && p.row === myRow?.row && p.gid).map(p => p.gid!);
      return [`${fm?.name ?? ''} · ${this.level === 'here' ? this.room ?? '' : `${fm?.building ?? ''} floor ${this.loc(this.store.gid(this.facility, 1))?.floor ?? ''}`}`,
        this.level === 'here' && rowMates.length ? `Your row: ${names(rowMates)}` : near.size ? `Near you (heard): ${names([...near.keys()])}` : 'Arrows select · OK opens · ZM− zooms out'];
    }
    const relTxt = (r: Rel) => (r === 'in' ? 'TALKING TO YOU' : r === 'out' ? 'you are talking to them' : r === 'both' ? 'TALKING WITH YOU'
      : r === 'listen' ? 'you hear them' : r === 'busy' ? 'on a call' : '');
    const l1 = `${sel.emoji} ${sel.label} · ${sel.sub}`;
    const selfLoc = this.loc(this.self);
    let where = '';
    if (sel.self) {
      where = sel.kind === 'site' ? 'Your site' : `You are here${near.size ? ` · near: ${names([...near.keys()])}` : ''}`;
    } else if (sel.kind !== 'site' && sel.gid && selfLoc?.room && selfLoc.room === this.loc(sel.gid)?.room
      && selfLoc.x !== undefined && selfLoc.y !== undefined) {
      const o = this.loc(sel.gid)!;
      const to = { x: o.x ?? 0, y: o.y ?? 0 };
      where = `${fmtM(planDistance({ x: selfLoc.x, y: selfLoc.y! }, to))} at ${clockDir(planBearing({ x: selfLoc.x, y: selfLoc.y! }, to))}`;
      if (near.has(sel.gid)) where += ` · heard ${near.get(sel.gid)} dB`;
    } else if (sel.ll && selfLoc?.lat !== undefined && selfLoc.lon !== undefined) {
      const a = { lat: selfLoc.lat, lon: selfLoc.lon };
      const km = distanceKm(a, sel.ll);
      where = km < 0.5 ? (sel.kind === 'site' ? 'Your site' : `same site${sel.room ? `, ${sel.room}` : ''}`)
        : `${fmtKm(km)} ${compass(bearingDeg(a, sel.ll))} (${Math.round(bearingDeg(a, sel.ll))}°)`;
    }
    return [l1, [relTxt(sel.rel), where].filter(Boolean).join(' · ')];
  }
}

const roomRank = (n: string) => (/control/i.test(n) ? 0 : /studio/i.test(n) ? 1 : 2);
const clip = (s: string, n: number) => (Array.from(s).length > n ? `${Array.from(s).slice(0, n - 1).join('')}…` : s);
