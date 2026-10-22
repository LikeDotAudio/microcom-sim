// Canvas crosspoint view of the full matrix: rows = sources (inputs), columns = destinations (outputs).
// Only routes are drawn (never the 4M cells); facility boundaries every `slice` ports.
import { cellAt, fitRange, hitRoute, pan, visibleRange, zoomAt, type Rect, type Viewport } from './gridMath';
import type { Store } from './store';
import { ROUTE_KINDS, type Route, type RouteKind } from './types';
import { el, fmtF } from './dom';

const GUTTER_L = 96;
const GUTTER_T = 84;

export function kindColor(kind: RouteKind): string {
  return `var(--rk-${kind})`;
}

export class GridView {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tip: HTMLElement;
  private info: HTMLElement;
  private vp: Viewport = { scale: 1, ox: GUTTER_L, oy: GUTTER_T };
  private w = 0;
  private h = 0;
  private dpr = 1;
  private pending = false;
  private hover: { src: number; dst: number } | null = null;
  private colors: Record<string, string> = {};
  private fitted = false;
  /** focused facility (-1 = all) */
  facility = -1;
  selected: number | null = null;
  onSelect: (gid: number) => void = () => {};

  constructor(private store: Store) {
    this.canvas = el('canvas', { class: 'grid-canvas', tabindex: '0', 'aria-label': 'Crosspoint matrix' });
    this.ctx = this.canvas.getContext('2d')!;
    this.tip = el('div', { class: 'grid-tip', hidden: '' });
    this.info = el('span', { class: 'grid-info muted' });
    const legend = el('div', { class: 'legend' },
      ...ROUTE_KINDS.map(k => el('span', { class: 'lg' },
        el('i', { style: `background:${kindColor(k)}` }), k)));
    const btn = (label: string, title: string, fn: () => void) => {
      const b = el('button', { class: 'btn sm', title }, label);
      b.addEventListener('click', fn);
      return b;
    };
    const toolbar = el('div', { class: 'grid-toolbar' },
      btn('Fit', 'Fit selected facility (or whole matrix)', () => this.fit()),
      btn('All', 'Show all 2048 × 2048', () => { this.fitAll(); }),
      btn('+', 'Zoom in', () => this.zoomCenter(1.5)),
      btn('−', 'Zoom out', () => this.zoomCenter(1 / 1.5)),
      this.info);
    const wrap = el('div', { class: 'grid-wrap' }, this.canvas, this.tip);
    this.root = el('div', { class: 'grid-view' }, toolbar, wrap, legend);
    this.bind(wrap);
    new ResizeObserver(() => this.resize(wrap)).observe(wrap);
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { this.readColors(); this.draw(); });
  }

  private get n() { return this.store.portCount || 2048; }
  private get plot(): Rect { return { x: GUTTER_L, y: GUTTER_T, w: this.w - GUTTER_L - 4, h: this.h - GUTTER_T - 4 }; }

  private readColors() {
    const cs = getComputedStyle(this.root);
    const get = (n: string) => cs.getPropertyValue(n).trim() || '#888';
    for (const k of ROUTE_KINDS) this.colors[k] = get(`--rk-${k}`);
    for (const n of ['--grid-bg', '--grid-area', '--grid-fac', '--grid-line', '--grid-sel', '--grid-hover',
      '--text', '--muted', '--accent']) this.colors[n] = get(n);
  }

  private resize(wrap: HTMLElement) {
    const r = wrap.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    this.dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    if (!this.fitted && this.store.ports.length) this.fit();
    this.readColors();
    this.drawNow();
  }

  private fitView(): Viewport {
    const s = this.store.slice;
    return this.facility >= 0 ? fitRange(this.plot, this.facility * s + 1, (this.facility + 1) * s)
      : fitRange(this.plot, 1, this.n);
  }

  fit() {
    if (!this.w) return;
    if (this.store.ports.length) this.fitted = true;
    this.vp = this.fitView();
    this.draw();
  }

  fitAll() {
    this.vp = fitRange(this.plot, 1, this.n);
    this.draw();
  }

  private zoomCenter(f: number) {
    const p = this.plot;
    this.vp = zoomAt(this.vp, p.x + p.w / 2, p.y + p.h / 2, f);
    this.draw();
  }

  setFacility(f: number) {
    this.facility = f;
    this.fit();
  }

  setSelected(gid: number | null) {
    this.selected = gid;
    this.draw();
  }

  private bind(wrap: HTMLElement) {
    const c = this.canvas;
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.vp = zoomAt(this.vp, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
      this.draw();
      this.updateHover(e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    let drag: { x: number; y: number; moved: boolean; id: number } | null = null;
    c.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect();
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (drag.moved || Math.abs(dx) + Math.abs(dy) > 3) {
          drag.moved = true;
          this.vp = pan(this.vp, dx, dy);
          drag.x = e.clientX; drag.y = e.clientY;
          c.classList.add('panning');
          this.tip.hidden = true;
          this.draw();
          return;
        }
      }
      this.updateHover(e.clientX - r.left, e.clientY - r.top);
    });
    c.addEventListener('pointerup', e => {
      if (!drag) return;
      const wasDrag = drag.moved;
      drag = null;
      c.classList.remove('panning');
      if (wasDrag) return;
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const hit = hitRoute(this.vp, x, y, this.n, this.store.routeIndex);
      const cell = hit ? { src: hit.src } : cellAt(this.vp, x, y, this.n);
      if (cell) this.onSelect(cell.src);
    });
    c.addEventListener('pointerleave', () => { this.hover = null; this.tip.hidden = true; this.draw(); });
    c.addEventListener('keydown', e => {
      const step = 40;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      if (moves[e.key]) { this.vp = pan(this.vp, ...moves[e.key]); this.draw(); e.preventDefault(); }
      else if (e.key === '+' || e.key === '=') this.zoomCenter(1.25);
      else if (e.key === '-') this.zoomCenter(0.8);
      else if (e.key === 'f') this.fit();
    });
    void wrap;
  }

  private updateHover(x: number, y: number) {
    const hit = hitRoute(this.vp, x, y, this.n, this.store.routeIndex);
    const cell = cellAt(this.vp, x, y, this.n);
    this.hover = hit ? { src: hit.src, dst: hit.dst } : cell;
    if (!this.hover) { this.tip.hidden = true; this.draw(); return; }
    const s = this.store;
    const { src, dst } = this.hover;
    this.tip.replaceChildren();
    this.tip.append(el('div', { class: 'tip-head' }, `${s.portName(src)} → ${s.portName(dst)}`));
    if (hit) {
      this.tip.append(el('div', {},
        el('i', { class: 'sw', style: `background:${kindColor(hit.kind)}` }), ` ${hit.kind}`,
        el('span', { class: 'muted' }, `  gain ${hit.gain}`)));
      this.tip.append(el('div', { class: 'muted' }, `via ${hit.via}`));
    } else {
      this.tip.append(el('div', { class: 'muted' }, 'no route'));
    }
    this.tip.hidden = false;
    const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
    this.tip.style.left = `${Math.min(x + 14, this.w - tw - 4)}px`;
    this.tip.style.top = `${y + 16 + th > this.h ? y - th - 8 : y + 16}px`;
    this.draw();
  }

  draw() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.drawNow(); });
  }

  drawNow() {
    const { ctx, vp, w, h, colors: C } = this;
    if (!w) return;
    if (!this.fitted && this.store.ports.length) { this.fitted = true; this.vp = this.fitView(); }
    const n = this.n, slice = this.store.slice, s = vp.scale;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = C['--grid-bg'];
    ctx.fillRect(0, 0, w, h);
    const p = this.plot;
    ctx.save();
    ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip();
    // matrix area
    ctx.fillStyle = C['--grid-area'];
    ctx.fillRect(vp.ox, vp.oy, n * s, n * s);
    const [x0, x1] = visibleRange(vp, p, n, 'x');
    const [y0, y1] = visibleRange(vp, p, n, 'y');
    // fine port lines when zoomed in
    if (s >= 6) {
      ctx.strokeStyle = C['--grid-line']; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = x0 - 1; i <= x1; i++) { const x = Math.round(vp.ox + i * s) + 0.5; ctx.moveTo(x, vp.oy + (y0 - 1) * s); ctx.lineTo(x, vp.oy + y1 * s); }
      for (let i = y0 - 1; i <= y1; i++) { const y = Math.round(vp.oy + i * s) + 0.5; ctx.moveTo(vp.ox + (x0 - 1) * s, y); ctx.lineTo(vp.ox + x1 * s, y); }
      ctx.stroke();
    }
    // section boundaries inside facilities (panels | IFB | remotes | util) when a facility is large
    if (s * slice > 260 && this.store.profile) {
      const cuts: number[] = []; let acc = 0;
      for (const sec of this.store.profile.sections) { acc += sec.count; if (acc < slice) cuts.push(acc); }
      ctx.strokeStyle = C['--grid-line']; ctx.setLineDash([3, 3]); ctx.beginPath();
      for (let f = Math.floor((x0 - 1) / slice); f <= Math.floor((x1 - 1) / slice); f++)
        for (const c of cuts) { const x = Math.round(vp.ox + (f * slice + c) * s) + 0.5; ctx.moveTo(x, p.y); ctx.lineTo(x, p.y + p.h); }
      for (let f = Math.floor((y0 - 1) / slice); f <= Math.floor((y1 - 1) / slice); f++)
        for (const c of cuts) { const y = Math.round(vp.oy + (f * slice + c) * s) + 0.5; ctx.moveTo(p.x, y); ctx.lineTo(p.x + p.w, y); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    // facility boundaries
    ctx.strokeStyle = C['--grid-fac']; ctx.lineWidth = 1; ctx.beginPath();
    for (let f = 0; f <= n / slice; f++) {
      const x = Math.round(vp.ox + f * slice * s) + 0.5, y = Math.round(vp.oy + f * slice * s) + 0.5;
      ctx.moveTo(x, vp.oy); ctx.lineTo(x, vp.oy + n * s);
      ctx.moveTo(vp.ox, y); ctx.lineTo(vp.ox + n * s, y);
    }
    ctx.stroke();
    // focused facility block
    if (this.facility >= 0) {
      ctx.strokeStyle = C['--accent']; ctx.lineWidth = 1.5;
      const a = this.facility * slice * s;
      ctx.strokeRect(vp.ox + a, vp.oy + a, slice * s, slice * s);
    }
    // selected station row + column
    const band = (gid: number, color: string) => {
      const k = Math.max(s, 2), off = (k - s) / 2;
      ctx.fillStyle = color;
      ctx.fillRect(vp.ox, vp.oy + (gid - 1) * s - off, n * s, k);
      ctx.fillRect(vp.ox + (gid - 1) * s - off, vp.oy, k, n * s);
    };
    if (this.selected) band(this.selected, C['--grid-sel']);
    if (this.hover) {
      ctx.fillStyle = C['--grid-hover'];
      const k = Math.max(s, 1);
      ctx.fillRect(vp.ox, vp.oy + (this.hover.src - 1) * s, n * s, k);
      ctx.fillRect(vp.ox + (this.hover.dst - 1) * s, vp.oy, k, n * s);
    }
    // routes, batched by kind
    const size = Math.max(s * (s >= 6 ? 0.76 : 1), 2.2);
    const off = (s - size) / 2;
    const groups = new Map<string, Route[]>();
    for (const r of this.store.routes) {
      if (r.dst < x0 || r.dst > x1 || r.src < y0 || r.src > y1) continue;
      let g = groups.get(r.kind); if (!g) groups.set(r.kind, g = []); g.push(r);
    }
    for (const kind of ROUTE_KINDS) {
      const g = groups.get(kind);
      if (!g) continue;
      ctx.fillStyle = ctx.strokeStyle = C[kind];
      for (const r of g) {
        const x = vp.ox + (r.dst - 1) * s + off, y = vp.oy + (r.src - 1) * s + off;
        if (r.gain <= 0) {             // muted (listen/mute while talking): hollow
          ctx.globalAlpha = 0.9; ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, Math.max(size - 1, 1.5), Math.max(size - 1, 1.5));
        } else {
          ctx.globalAlpha = r.gain >= 1 ? 1 : 0.35 + 0.6 * r.gain;
          ctx.fillRect(x, y, size, size);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    this.drawGutters(x0, x1, y0, y1);
    this.info.textContent = `${Math.round(s * 100) / 100} px/port · ${x1 - x0 + 1}×${y1 - y0 + 1} visible`;
  }

  /** Selected station's connections: who it feeds (by destination) and who feeds it (by source). */
  private connections(): { out: Map<number, string>; inn: Map<number, string> } {
    const out = new Map<number, string>(), inn = new Map<number, string>();
    const sel = this.selected;
    if (sel) {
      for (const r of this.store.routes) {
        if (r.gain <= 0) continue;
        if (r.src === sel && !out.has(r.dst)) out.set(r.dst, r.kind);
        if (r.dst === sel && !inn.has(r.src)) inn.set(r.src, r.kind);
      }
    }
    return { out, inn };
  }

  private portText(g: number): string {
    const port = this.store.port(g);
    if (!port) return '';
    const mn = port.mnemonic.trim();
    return `${port.label.split(' ').slice(1).join(' ')}${mn ? ' ' + mn : ''}`;
  }

  private drawGutters(x0: number, x1: number, y0: number, y1: number) {
    const { ctx, vp, colors: C } = this;
    const slice = this.store.slice, s = vp.scale, p = this.plot;
    const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    const { out, inn } = this.connections();
    const sel = this.selected, hov = this.hover;
    const labelColor = (g: number, link: Map<number, string>, hovered: boolean) =>
      g === sel ? C['--accent'] : link.has(g) ? C[link.get(g)!] : hovered ? C['--text'] : C['--muted'];
    ctx.font = `10px ${mono}`;
    ctx.textBaseline = 'middle';
    // ---- top gutter: facility labels, destination labels / sash ticks -------------------------
    const fs = slice * s;
    const every = fs >= 30 ? 1 : fs >= 14 ? 2 : fs >= 7 ? 4 : 8;
    ctx.save();
    ctx.beginPath(); ctx.rect(p.x, 0, p.w, GUTTER_T); ctx.clip();
    ctx.textAlign = 'left';
    for (let f = Math.floor((x0 - 1) / slice); f <= Math.floor((x1 - 1) / slice); f++) {
      if (f % every) continue;
      const x = vp.ox + f * fs;
      ctx.fillStyle = f === this.facility ? C['--accent'] : C['--muted'];
      ctx.fillText(fmtF(f), Math.max(x + 2, p.x + 2), 8);
    }
    if (s >= 9) {                       // rotated destination labels (one per column)
      ctx.font = `${Math.min(10, Math.floor(s))}px ${mono}`;
      ctx.textAlign = 'left';            // rotated -90°: text runs upwards from the matrix edge
      for (let g = x0; g <= x1; g++) {
        const txt = this.portText(g);
        if (!txt) continue;
        ctx.save();
        ctx.translate(vp.ox + (g - 0.5) * s, GUTTER_T - 3);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = labelColor(g, out, hov?.dst === g);
        ctx.font = `${g === sel || out.has(g) ? 'bold ' : ''}${Math.min(10, Math.floor(s))}px ${mono}`;
        ctx.fillText(txt, 0, 0);
        ctx.restore();
      }
    } else {                            // zoomed out: sash ticks where the selected station connects
      for (const [g, kind] of out) {
        if (g < x0 || g > x1) continue;
        ctx.fillStyle = C[kind];
        ctx.fillRect(vp.ox + (g - 1) * s + s / 2 - 1.5, GUTTER_T - 14, 3, 12);
      }
      if (sel && sel >= x0 && sel <= x1) {
        ctx.fillStyle = C['--accent'];
        ctx.fillRect(vp.ox + (sel - 1) * s + s / 2 - 1.5, GUTTER_T - 20, 3, 18);
      }
    }
    ctx.restore();
    // ---- left gutter: facility labels, source labels / sash ticks -----------------------------
    ctx.save();
    ctx.beginPath(); ctx.rect(0, p.y, GUTTER_L, p.h); ctx.clip();
    ctx.textAlign = 'left';
    for (let f = Math.floor((y0 - 1) / slice); f <= Math.floor((y1 - 1) / slice); f++) {
      if (f % every || s >= 9) continue;
      const y = vp.oy + f * fs;
      ctx.fillStyle = f === this.facility ? C['--accent'] : C['--muted'];
      ctx.fillText(fmtF(f), 3, Math.max(y + 7, p.y + 7));
    }
    if (s >= 9) {
      for (let g = y0; g <= y1; g++) {
        const txt = this.portText(g);
        if (!txt) continue;
        ctx.fillStyle = labelColor(g, inn, hov?.src === g);
        ctx.font = `${g === sel || inn.has(g) ? 'bold ' : ''}${Math.min(10, Math.floor(s))}px ${mono}`;
        ctx.fillText(txt, 2, vp.oy + (g - 0.5) * s);
      }
    } else {
      for (const [g, kind] of inn) {
        if (g < y0 || g > y1) continue;
        ctx.fillStyle = C[kind];
        ctx.fillRect(GUTTER_L - 14, vp.oy + (g - 1) * s + s / 2 - 1.5, 12, 3);
      }
      if (sel && sel >= y0 && sel <= y1) {
        ctx.fillStyle = C['--accent'];
        ctx.fillRect(GUTTER_L - 20, vp.oy + (sel - 1) * s + s / 2 - 1.5, 18, 3);
      }
    }
    ctx.restore();
    ctx.fillStyle = C['--muted'];
    ctx.font = `10px ${mono}`;
    ctx.textAlign = 'left';
    ctx.fillText('src↓ dst→', 2, 8);
  }
}
