// 'Recently said' screen in the old vent grille: the focused segment (who, when, caption with word
// highlight while replaying), the latest items, and a 10-minute scrubber with unread/missed markers.
import { r2, svg } from '../matrix/panelSvg';
import type { Store } from '../matrix/store';
import type { SaidItem } from '../matrix/types';
import {
  activeWord, agoLabel, counts, itemAt, itemKey, itemsFor, lanes, timeToX, wordLines, wrap, xToTime,
  type ReadState,
} from './history';

export interface ScreenOpts {
  /** station whose screen this is (said to / by it); producer screens show the whole production */
  gid: number;
  producer: boolean;
  facility: () => number;
  /** WAV URL of a segment */
  clipUrl: (id: number) => string | Promise<string>;
}

const W_FOCUS = 190;
const LANES = 3;

export class SaidScreen {
  private el: SVGSVGElement | null = null;
  private w = 282; private h = 50;
  items: SaidItem[] = [];
  /** focused item id; null = follow the newest */
  focus: number | null = null;
  /** scrub cursor time; null = live (right edge) */
  cursor: number | null = null;
  rs: ReadState;
  private audio: HTMLAudioElement | null = null;
  playing: number | null = null;
  private raf = 0;
  private seenTimer: ReturnType<typeof setTimeout> | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  status = '';

  constructor(private store: Store, private o: ScreenOpts) {
    this.rs = { seen: new Set(this.loadSeen()), missed: new Set() };
  }

  private get storeKey() { return `m26-seen-${this.o.gid}`; }
  private loadSeen(): string[] {
    try { return JSON.parse(localStorage.getItem(this.storeKey) ?? '[]'); } catch { return []; }
  }
  private saveSeen() {
    try { localStorage.setItem(this.storeKey, JSON.stringify([...this.rs.seen].slice(-400))); } catch { /* ignore */ }
  }

  mount(el: SVGSVGElement) {
    this.el = el;
    const vb = el.viewBox.baseVal;
    this.w = vb.width; this.h = vb.height;
    el.addEventListener('pointerdown', e => this.pointer(e));
    if (!this.tick) this.tick = setInterval(() => { if (!this.playing) this.render(); }, 5000);
    this.refresh();
  }

  dispose() {
    this.stop();
    if (this.tick) clearInterval(this.tick);
    if (this.seenTimer) clearTimeout(this.seenTimer);
    this.tick = null;
  }

  private now() { return Date.now() / 1000; }

  private pred = (it: SaidItem) => {
    if (!this.o.producer) return it.src === this.o.gid || it.dsts.includes(this.o.gid);
    const f = this.o.facility();
    return this.store.facilityOf(it.src) === f || it.dsts.some(d => this.store.facilityOf(d) === f);
  };

  /** Re-read items from the store (after history/said messages). */
  refresh() {
    this.items = itemsFor(this.store.said.values(), this.pred, this.now());
    if (this.focus !== null && !this.items.some(i => i.id === this.focus)) this.focus = null;
    this.render();
  }

  /** A live segment arrived: note it as missed when nobody was listening. */
  noteLive(it: SaidItem, heardLive: boolean) {
    if (!heardLive && it.src !== this.o.gid) this.rs.missed.add(itemKey(it));
  }

  private focused(): SaidItem | null {
    if (this.focus !== null) return this.items.find(i => i.id === this.focus) ?? null;
    for (let i = this.items.length - 1; i >= 0; i--) if (this.items[i].src !== this.o.gid || this.o.producer) return this.items[i];
    return this.items[this.items.length - 1] ?? null;
  }

  private markSeen(it: SaidItem | null, delay = 1500) {
    if (this.seenTimer) clearTimeout(this.seenTimer);
    if (!it) return;
    this.seenTimer = setTimeout(() => {
      this.rs.seen.add(itemKey(it));
      this.saveSeen();
      this.onChange?.();
      this.render();
    }, delay);
  }

  onChange: (() => void) | null = null;

  ackAll() {
    for (const it of this.items) this.rs.seen.add(itemKey(it));
    this.saveSeen();
    this.render();
    this.onChange?.();
  }

  select(id: number | null) {
    this.focus = id;
    const it = this.focused();
    if (id !== null && it) this.cursor = (it.t0 + it.t1) / 2;
    if (id === null) this.cursor = null;
    this.markSeen(it);
    this.render();
  }

  /** Step through items (keypad/arrow), -1 = older. */
  step(d: number) {
    if (!this.items.length) return;
    const cur = this.focused();
    let i = cur ? this.items.indexOf(cur) + d : this.items.length - 1;
    i = Math.max(0, Math.min(this.items.length - 1, i));
    this.select(this.items[i].id);
  }

  togglePlay(id?: number) {
    const it = id !== undefined ? this.items.find(i => i.id === id) : this.focused();
    if (!it) return;
    if (this.playing === it.id) { this.stop(); return; }
    this.stop();
    this.focus = it.id;
    this.cursor = it.t0;
    const a = new Audio();
    const src = this.o.clipUrl(it.id);
    this.audio = a;
    this.playing = it.id;
    this.status = 'loading…';
    a.addEventListener('playing', () => { this.status = ''; });
    a.addEventListener('ended', () => this.stop());
    a.addEventListener('error', () => { this.status = 'clip unavailable'; this.stop(true); });
    void Promise.resolve(src).then(u => {
      if (this.audio !== a) return;
      a.src = u;
      return a.play().catch(() => { this.status = 'playback blocked'; this.stop(true); });
    }, () => { this.status = 'clip unavailable'; this.stop(true); });
    this.rs.seen.add(itemKey(it));
    this.saveSeen();
    this.onChange?.();
    const loop = () => {
      if (!this.audio || this.playing !== it.id) return;
      this.cursor = it.t0 + this.audio.currentTime;
      this.render();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.render();
  }

  stop(keepStatus = false) {
    cancelAnimationFrame(this.raf);
    if (this.audio) { this.audio.pause(); this.audio.src = ''; }
    this.audio = null;
    this.playing = null;
    if (!keepStatus) this.status = '';
    this.render();
  }

  get playTime(): number { return this.audio?.currentTime ?? 0; }

  // ---- interaction --------------------------------------------------------------------------------
  private toLocal(e: PointerEvent): { x: number; y: number } {
    const m = this.el!.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }

  private pointer(e: PointerEvent) {
    if (!this.el) return;
    const p = this.toLocal(e);
    const tgt = (e.target as Element).closest('[data-act]');
    const act = tgt?.getAttribute('data-act');
    if (act) {
      e.stopPropagation();
      const id = Number(tgt!.getAttribute('data-id'));
      if (act === 'play') this.togglePlay(id || undefined);
      else if (act === 'row') { this.select(id); }
      else if (act === 'ack') this.ackAll();
      else if (act === 'live') this.select(null);
      return;
    }
    if (p.y < this.h - 15) return;
    // scrubber: drag to scrub, click a bar to play it
    e.preventDefault();
    this.el.setPointerCapture(e.pointerId);
    const x0 = 6, w = this.w - 12;
    let moved = false;
    const start = p.x;
    const at = (x: number) => {
      const now = this.now();
      if (x >= x0 + w - 2) { this.select(null); return; }
      const t = xToTime(x, now, x0, w);
      const i = itemAt(this.items, t, 30);
      this.focus = i >= 0 ? this.items[i].id : this.focus;
      this.cursor = t;
      this.markSeen(i >= 0 ? this.items[i] : null);
      this.render();
    };
    at(p.x);
    const move = (ev: PointerEvent) => { const q = this.toLocal(ev); if (Math.abs(q.x - start) > 1) moved = true; at(q.x); };
    const up = () => {
      this.el?.removeEventListener('pointermove', move);
      this.el?.removeEventListener('pointerup', up);
      const hit = (e.target as Element).closest('[data-bar]');
      if (!moved && hit) this.togglePlay(Number(hit.getAttribute('data-bar')));
    };
    this.el.addEventListener('pointermove', move);
    this.el.addEventListener('pointerup', up);
  }

  // ---- drawing ------------------------------------------------------------------------------------
  private who(gid: number): { emoji: string; name: string; role: string; mn: string } {
    const m = this.store.personOf(gid);
    const p = this.store.port(gid);
    return { emoji: m.emoji ?? '', name: m.name ?? (p?.mnemonic.trim() || p?.label || `#${gid}`), role: m.role ?? '', mn: p?.mnemonic.trim() ?? '' };
  }

  private short(gid: number): string {
    const w = this.who(gid);
    return w.name.split(' ')[0];
  }

  render() {
    const el = this.el;
    if (!el) return;
    const now = this.now();
    const W = this.w, H = this.h;
    const kids: SVGElement[] = [svg('rect', { x: 0, y: 0, width: W, height: H, class: 'm26-scr-bg' })];
    const c = counts(this.items, this.rs, this.o.producer ? undefined : this.o.gid);
    // header
    kids.push(svg('text', { x: 3, y: 5, class: 'm26-scr-h' }, this.o.producer ? 'PRODUCTION · EVERYTHING SAID' : 'RECENTLY SAID TO YOU'));
    let hx = this.o.producer ? 62 : 50;
    const badge = (txt: string, cls: string, act?: string) => {
      const wdt = txt.length * 1.75 + 3;
      kids.push(svg('g', act ? { 'data-act': act, class: 'm26-btn' } : {},
        svg('rect', { x: hx, y: 1.3, width: r2(wdt), height: 4.8, rx: 1, class: `m26-badge ${cls}` }),
        svg('text', { x: r2(hx + wdt / 2), y: 4.8, class: 'm26-badge-t', 'text-anchor': 'middle' }, txt)));
      hx += wdt + 1.5;
    };
    if (c.unread) badge(`${c.unread} NEW`, 'new', 'ack');
    if (c.missed) badge(`${c.missed} MISSED`, 'missed', 'ack');
    if (c.unread) badge('ACK', 'ack', 'ack');
    const live = this.cursor === null && this.focus === null;
    kids.push(svg('g', { 'data-act': 'live', class: 'm26-btn' },
      svg('text', { x: W - 3, y: 5, class: `m26-scr-h ${live ? 'm26-live' : ''}`, 'text-anchor': 'end' },
        this.playing ? `▶ REPLAY ${this.status}` : live ? '● LIVE' : `◀ ${agoLabel(now - (this.cursor ?? now))} · LIVE ▸`)));
    // focused item
    const f = this.focused();
    if (!f) {
      kids.push(svg('text', { x: 3, y: 17, class: 'm26-cap dim' }, this.o.producer
        ? 'Nothing said in this production in the last 10 minutes.'
        : 'Nothing said to this station in the last 10 minutes.'),
      svg('text', { x: 3, y: 23.5, class: 'm26-cap dim small' }, 'Talk segments appear here when panels have intercom audio joined.'));
    } else {
      const w = this.who(f.src);
      const dst = this.o.producer ? ` → ${f.dsts.slice(0, 3).map(d => this.short(d)).join(', ')}${f.dsts.length > 3 ? '…' : ''}` : '';
      const unread = !this.rs.seen.has(itemKey(f)) && f.src !== this.o.gid;
      kids.push(svg('text', { x: 3, y: 12, class: 'm26-who' },
        svg('tspan', { class: 'm26-emoji' }, w.emoji ? `${w.emoji} ` : ''),
        `${w.name}`, svg('tspan', { class: 'm26-role', dx: 1.5 }, `${w.role}${w.mn ? ` (${w.mn})` : ''}${dst}`),
        svg('tspan', { class: 'm26-ago', dx: 2 }, `${agoLabel(now - f.t1)} · ${(f.t1 - f.t0).toFixed(1)} s`),
        ...(unread ? [svg('tspan', { class: 'm26-newtag', dx: 1.5 }, this.rs.missed.has(itemKey(f)) ? 'MISSED' : 'NEW')] : [])));
      // play button
      const pl = this.playing === f.id;
      kids.push(svg('g', { 'data-act': 'play', 'data-id': f.id, class: 'm26-btn' },
        svg('circle', { cx: W_FOCUS - 4, cy: 10.3, r: 3.2, class: 'm26-play' }),
        svg('text', { x: W_FOCUS - 4, y: 11.6, class: 'm26-play-t', 'text-anchor': 'middle' }, pl ? '■' : '▶')));
      const cw = Math.floor((W_FOCUS - 6) / (3.6 * 0.56));
      if (f.words?.length) {
        const cur = pl ? activeWord(f.words, this.playTime) : -1;
        const lines = wordLines(f.words.map(x => x[2]), cw, 3, Math.max(0, cur));
        lines.forEach((ln, li) => {
          const t = svg('text', { x: 3, y: r2(19 + li * 5.6), class: 'm26-cap' });
          ln.forEach((x, j) => t.append(svg('tspan', { class: x.i === cur ? 'm26-word on' : x.i < cur ? 'm26-word past' : 'm26-word' }, `${j ? ' ' : ''}${x.w}`)));
          kids.push(t);
        });
      } else {
        const txt = f.text ?? (now - f.t1 < 90 ? 'Captioning…' : '(no caption — press ▶ to listen)');
        wrap(txt, cw, 3).forEach((ln, li) => kids.push(svg('text', { x: 3, y: r2(19 + li * 5.6), class: `m26-cap${f.text ? '' : ' dim'}` }, ln)));
      }
    }
    // latest list (right column)
    kids.push(svg('line', { x1: W_FOCUS + 1, y1: 7.5, x2: W_FOCUS + 1, y2: H - 16, class: 'm26-rule' }));
    const recent = this.items.slice(-5).reverse();
    const lw = Math.floor((W - W_FOCUS - 5) / (2.8 * 0.56));
    recent.forEach((it, i) => {
      const w = this.who(it.src);
      const k = itemKey(it);
      const unread = !this.rs.seen.has(k) && it.src !== this.o.gid;
      const missed = unread && this.rs.missed.has(k);
      const body = `${agoLabel(now - it.t1).replace(' ago', '')} ${w.name.split(' ')[0]}: ${it.text ?? '…'}`;
      const txt = Array.from(body).length > lw ? `${Array.from(body).slice(0, lw - 1).join('')}…` : body;
      kids.push(svg('g', { 'data-act': 'row', 'data-id': it.id, class: `m26-btn m26-row${f?.id === it.id ? ' sel' : ''}${unread ? ' unread' : ''}${missed ? ' missed' : ''}` },
        svg('rect', { x: W_FOCUS + 2.5, y: r2(8 + i * 5.3), width: W - W_FOCUS - 4, height: 5, rx: 0.8, class: 'm26-row-bg' }),
        svg('text', { x: W_FOCUS + 4, y: r2(11.8 + i * 5.3), class: 'm26-row-t' }, `${missed ? '! ' : unread ? '• ' : ''}${w.emoji} ${txt}`)));
    });
    // scrubber
    const x0 = 6, sw = W - 12, ty = H - 14;
    kids.push(svg('rect', { x: x0 - 1, y: ty - 0.5, width: sw + 2, height: 9.5, rx: 1, class: 'm26-scrub-bg' }));
    for (let m = 0; m <= 10; m++) {
      const x = timeToX(now - m * 60, now, x0, sw);
      kids.push(svg('line', { x1: r2(x), y1: ty, x2: r2(x), y2: ty + 9, class: 'm26-tick' }));
      if (m % 2 === 0) kids.push(svg('text', { x: r2(x), y: H - 0.8, class: 'm26-tick-t', 'text-anchor': m === 0 ? 'end' : 'middle' }, m === 0 ? 'now' : `-${m}m`));
    }
    const ln = lanes(this.items, LANES);
    this.items.forEach((it, i) => {
      const xa = timeToX(it.t0, now, x0, sw), xb = Math.max(xa + 0.9, timeToX(it.t1, now, x0, sw));
      const k = itemKey(it);
      const unread = !this.rs.seen.has(k) && it.src !== this.o.gid;
      const missed = unread && this.rs.missed.has(k);
      const y = ty + 0.8 + ln[i] * 2.7;
      kids.push(svg('rect', { x: r2(xa), y: r2(y), width: r2(xb - xa), height: 2.2, rx: 0.4, 'data-bar': it.id,
        class: `m26-bar${it.src === this.o.gid ? ' own' : ''}${f?.id === it.id ? ' sel' : ''}${missed ? ' missed' : unread ? ' unread' : ''}` }));
      if (unread) kids.push(svg('circle', { cx: r2(xa), cy: ty - 1.4, r: 0.9, class: `m26-mark${missed ? ' missed' : ''}` }));
    });
    const cx = timeToX(this.cursor ?? now, now, x0, sw);
    kids.push(svg('line', { x1: r2(cx), y1: ty - 2.5, x2: r2(cx), y2: ty + 9, class: 'm26-cursor' }),
      svg('path', { d: `M ${r2(cx - 1.4)} ${ty - 3} L ${r2(cx + 1.4)} ${ty - 3} L ${r2(cx)} ${ty - 1} Z`, class: 'm26-cursor-h' }));
    el.replaceChildren(...kids);
  }
}
