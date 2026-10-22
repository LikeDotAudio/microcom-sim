// MicroCOM 2026 station / producer panel controller: owns the faceplate and its live parts (recently
// said screen, map, LED ticker, production selector, talent strip) and keeps them in step with the store.
// KeypanelView embeds it for panel models M2026 / M2026P and binds the paddle keys as usual.
import { fmtF } from '../matrix/dom';
import { r2, svg } from '../matrix/panelSvg';
import type { Store, StoreTopic } from '../matrix/store';
import { vuSegments } from '../matrix/turret';
import { LISTEN_KINDS, TALK_KINDS, type SaidItem, type Station, type StationKey } from '../matrix/types';
import type { MatrixClient } from '../matrix/ws';
import { renderFace, updateLegend, type FaceHandles } from './face';
import { keyLegend, keyTarget } from './labels';
import { StationMap } from './map';
import { SaidScreen } from './screen';
import { clipSrc } from '../local/mode';

/** Page hooks (set by the panel page): is this station's intercom audio live right now? */
export const m2026Env = {
  audioOn: (_gid: number) => true,          // unknown (matrix page): never mark items missed
};

const VU_N = 10;

export interface BuiltPanel { svg: SVGSVGElement; keys: Map<number, SVGGElement>; extra: [Element, number][] }

export class M2026View {
  readonly producer: boolean;
  facility: number;
  readonly screen: SaidScreen;
  readonly map: StationMap;
  private face: FaceHandles | null = null;
  private st: Station | null = null;
  private unsub: () => void;
  private raf = 0;
  private dirty = new Set<string>();
  private talentEls: { gid: number; tile: SVGGElement; segs: SVGRectElement[]; slot: number | null; pad: SVGGElement }[] = [];
  private allBtn: SVGGElement | null = null;
  private requested = new Set<number>();
  private hlTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private store: Store, private client: MatrixClient, readonly gid: number, model: string) {
    this.producer = model === 'M2026P';
    this.facility = store.facilityOf(gid);
    const k = new URLSearchParams(location.search).get('k');
    this.screen = new SaidScreen(store, {
      gid, producer: this.producer, facility: () => this.facility,
      clipUrl: id => clipSrc(id, k),
    });
    this.map = new StationMap(store, gid, this.facility, this.producer ? 'there' : 'here');
    this.map.onPick = g => this.highlightKeysFor(g);
    this.map.onFacility = f => this.setFacility(f, false);
    this.unsub = store.subscribe((t, d) => this.onStore(t, d));
    this.requestHistory();
    if (store.role.admin) client.send({ t: 'near' });
  }

  dispose() {
    this.unsub();
    cancelAnimationFrame(this.raf);
    this.screen.dispose();
    this.map.dispose();
  }

  // ---- data requests ---------------------------------------------------------------------------------
  private requestHistory(force = false) {
    if (!this.store.connected) return;
    if (force) this.requested.clear();
    const gids = this.producer && this.store.role.admin
      ? this.store.facilityPorts(this.facility).filter(p => p.kind === 'panel' || p.kind === 'ifb' || p.kind === 'remote').map(p => p.gid)
      : [this.gid];
    for (const g of gids) {
      if (this.requested.has(g)) continue;
      if (this.client.send({ t: 'history', gid: g })) this.requested.add(g);
    }
  }

  setFacility(f: number, moveMap = true) {
    const n = this.store.facilityCount;
    this.facility = ((f % n) + n) % n;
    if (moveMap) this.map.setFacility(this.facility);
    this.requestHistory();
    this.screen.refresh();
    this.drawProd();
  }

  // ---- build -------------------------------------------------------------------------------------------
  build(st: Station): BuiltPanel {
    this.st = st;
    this.screen.dispose();
    const legendOf = (k: StationKey, max: number) => {
      const t = keyTarget(k);
      return keyLegend(k, t ? this.store.meta.get(t) : undefined, max);
    };
    const titleOf = (k: StationKey) => {
      const t = keyTarget(k);
      const m = t ? this.store.meta.get(t) : undefined;
      const who = m?.name ? `${m.emoji ?? ''} ${m.name}${m.role ? ` — ${m.role}` : ''}` : '';
      const to = k.kind === 'bus' && t ? this.store.portName(t) : k.kind === 'ext' ? (k.targets ?? []).map(x => this.store.portName(x)).join(', ') : '';
      return [`${k.name.trim()} ${k.kind === 'bus' ? k.mode ?? '' : k.kind}`.trim(), who, to && `→ ${to}`].filter(Boolean).join('\n');
    };
    const f = renderFace(st, this.producer, legendOf, titleOf);
    this.face = f;
    this.screen.mount(f.screen);
    this.map.mount(f.map);
    this.screen.onChange = () => this.drawTicker();
    f.ident.addEventListener('click', () => this.editIdentity());
    for (const [act, b] of f.pad) {
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        b.classList.add('down');
        setTimeout(() => b.classList.remove('down'), 140);
        this.act(act);
      });
    }
    f.prod.addEventListener('pointerdown', e => {
      const a = (e.target as Element).closest('[data-act]')?.getAttribute('data-act');
      if (a === 'prev') this.setFacility(this.facility - 1);
      else if (a === 'next') this.setFacility(this.facility + 1);
      else if (a === 'home') this.setFacility(this.store.facilityOf(this.gid));
    });
    const extra = this.drawTalent();
    this.drawIdent();
    this.drawProd();
    this.drawTicker();
    this.updateCalling();
    return { svg: f.svg, keys: f.keys, extra };
  }

  /** Keypad and keyboard navigation (arrows move on the map, PgUp/PgDn step the screen). */
  act(a: string) {
    switch (a) {
      case 'prdprev': this.setFacility(this.facility - 1); break;
      case 'prdnext': this.setFacility(this.facility + 1); break;
      case 'ack': this.screen.ackAll(); break;
      case 'play': this.screen.togglePlay(); break;
      case 'older': this.screen.step(-1); break;
      case 'newer': this.screen.step(1); break;
      default: this.map.act(a);
    }
  }

  /** Keyboard: returns true when the key was a navigation key. */
  onKey(e: KeyboardEvent): boolean {
    const map: Record<string, string> = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', '+': 'zin', '=': 'zin',
      '-': 'zout', h: 'here', t: 'there', w: 'every', m: 'map', e: 'me', p: 'play', k: 'ack', PageUp: 'older', PageDown: 'newer',
      '[': 'prdprev', ']': 'prdnext',
    };
    const a = map[e.key];
    if (!a) return false;
    this.act(a);
    return true;
  }

  // ---- store -------------------------------------------------------------------------------------------
  private onStore(t: StoreTopic, d: unknown) {
    switch (t) {
      case 'snapshot': this.requestHistory(true); this.schedule('legends', 'map', 'ident', 'prod', 'screen'); if (this.store.role.admin) this.client.send({ t: 'near' }); break;
      case 'conn': if (this.store.connected) this.requestHistory(true); break;
      case 'routes': this.schedule('map', 'ticker', 'talent', 'calling'); break;
      case 'levels': this.schedule('vu'); break;
      case 'meta': this.schedule('legends', 'map', 'ident', 'prod', 'screen', 'ticker', 'talentname'); break;
      case 'near': this.schedule('map'); break;
      case 'said': {
        if (d && typeof d === 'object' && 'id' in (d as SaidItem)) {
          const it = d as SaidItem;
          const mine = it.dsts.includes(this.gid);
          this.screen.noteLive(it, mine ? m2026Env.audioOn(this.gid) : true);
        }
        this.screen.refresh();
        this.drawTicker();
        break;
      }
    }
  }

  private schedule(...parts: string[]) {
    for (const p of parts) this.dirty.add(p);
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const d = this.dirty;
      this.dirty = new Set();
      if (d.has('legends')) this.updateLegends();
      if (d.has('map')) this.map.render();
      if (d.has('screen')) this.screen.refresh();
      if (d.has('ident')) this.drawIdent();
      if (d.has('prod')) this.drawProd();
      if (d.has('ticker')) this.drawTicker();
      if (d.has('talentname') && this.st) this.drawTalent();
      if (d.has('talent') || d.has('vu')) this.updateTalent();
      if (d.has('calling')) this.updateCalling();
    });
  }

  private updateLegends() {
    const f = this.face, st = this.st;
    if (!f || !st) return;
    const max = Math.max(1, Math.floor((f.layout.keys[0].win.w - 1.2) / (3.1 * 0.6)));
    for (const c of f.layout.keys) {
      const t = keyTarget(c.key);
      updateLegend(f, c.slot, keyLegend(c.key, t ? this.store.meta.get(t) : undefined, max));
    }
  }

  /** Keys whose target is talking to this station get the 'calling' glow. */
  private updateCalling() {
    const f = this.face;
    if (!f) return;
    for (const c of f.layout.keys) {
      const t = keyTarget(c.key);
      const r = t ? this.store.route(t, this.gid) : undefined;
      f.keys.get(c.slot)?.classList.toggle('calling', !!r && r.gain > 0 && TALK_KINDS.has(r.kind));
    }
  }

  private highlightKeysFor(g: number) {
    const f = this.face;
    if (!f) return;
    if (this.hlTimer) clearTimeout(this.hlTimer);
    for (const c of f.layout.keys) f.keys.get(c.slot)?.classList.toggle('m26-hl', keyTarget(c.key) === g || !!c.key.targets?.includes(g));
    this.hlTimer = setTimeout(() => { for (const k of f.keys.values()) k.classList.remove('m26-hl'); }, 2500);
  }

  private editIdentity() {
    const m = this.store.personOf(this.gid);
    const name = prompt('Your name on this panel (shown on other stations’ keys and maps):', m.name ?? '');
    if (name === null) return;
    const emoji = prompt('Your emoji:', m.emoji ?? '🎧');
    if (emoji === null) return;
    this.client.send({ t: 'meta', gid: this.gid, meta: { name: name.trim(), emoji: emoji.trim() } });
  }

  // ---- small displays ------------------------------------------------------------------------------------
  private drawIdent() {
    const f = this.face, st = this.st;
    if (!f || !st) return;
    const { x, y, w } = f.layout.ident;
    const m = this.store.personOf(this.gid);
    const fm = this.store.facMeta.get(st.facility);
    const name = m.name ?? (st.mnemonic.trim() || st.label);
    f.ident.replaceChildren(
      svg('rect', { x, y, width: w, height: 42, rx: 1.4, class: 'm26-ident-bg' }),
      svg('text', { x: x + 2, y: y + 10, class: 'm26-ident-emoji' }, m.emoji ?? '🎧'),
      svg('text', { x: x + 2, y: y + 17.5, class: 'm26-ident-name' }, clip(name, 15)),
      svg('text', { x: x + 2, y: y + 22.5, class: 'm26-ident-role' }, clip(m.role ?? '', 20)),
      svg('text', { x: x + 2, y: y + 28, class: 'm26-ident-sub' }, `${st.label} · ${st.mnemonic.trim()}`),
      svg('text', { x: x + 2, y: y + 32.5, class: 'm26-ident-sub' }, clip(fm?.name ?? fmtF(st.facility), 22)),
      svg('text', { x: x + 2, y: y + 37, class: 'm26-ident-sub' }, clip([m.location?.room, m.location?.row !== undefined ? `row ${m.location.row}` : '', m.location?.seat !== undefined ? `seat ${m.location.seat}` : ''].filter(Boolean).join(' · '), 24)),
      svg('text', { x: x + w - 1.5, y: y + 5, class: 'm26-ident-edit', 'text-anchor': 'end' }, '✎'));
  }

  private drawProd() {
    const f = this.face;
    if (!f) return;
    const { x, y, w, h } = f.layout.prod;
    const fm = this.store.facMeta.get(this.facility);
    const home = this.facility === this.store.facilityOf(this.gid);
    const txt = `${fmtF(this.facility)} · ${fm?.name ?? ''}${fm?.site ? ` · ${fm.site}` : ''}`;
    f.prod.replaceChildren(
      svg('rect', { x: x - 0.5, y: y - 0.5, width: w + 1, height: h + 1, rx: 1.2, class: 'm26-frame' }),
      svg('rect', { x, y, width: w, height: h, rx: 0.8, class: 'm26-win' }),
      svg('g', { 'data-act': 'prev', class: 'm26-btn' }, svg('rect', { x, y, width: 9, height: h, class: 'm26-hit' }),
        svg('text', { x: x + 4.5, y: y + h / 2 + 1.5, class: 'm26-led m26-prod-arrow', 'text-anchor': 'middle' }, '◀')),
      svg('g', { 'data-act': 'next', class: 'm26-btn' }, svg('rect', { x: x + w - 9, y, width: 9, height: h, class: 'm26-hit' }),
        svg('text', { x: x + w - 4.5, y: y + h / 2 + 1.5, class: 'm26-led m26-prod-arrow', 'text-anchor': 'middle' }, '▶')),
      svg('g', { 'data-act': 'home', class: 'm26-btn' },
        svg('text', { x: x + w / 2, y: y + h / 2 + 1.3, class: `m26-led m26-prod-t${home ? '' : ' away'}`, 'text-anchor': 'middle' }, clip(txt, 34))));
  }

  private drawTicker() {
    const f = this.face;
    if (!f) return;
    const { x, y, w, h } = f.layout.ticker;
    const s = this.store, g = this.gid;
    const nm = (o: number) => {
      const m = s.personOf(o);
      const mn = s.port(o)?.mnemonic.trim();
      return m.name ? `${m.emoji ?? ''}${m.name.split(' ')[0]}${mn ? ` (${mn})` : ''}` : s.portName(o);
    };
    const out = (s.bySrc.get(g) ?? []).filter(r => r.gain > 0 && TALK_KINDS.has(r.kind) && r.dst !== g).map(r => r.dst);
    const inn = (s.byDst.get(g) ?? []).filter(r => r.gain > 0 && (TALK_KINDS.has(r.kind) || LISTEN_KINDS.has(r.kind) || r.kind === 'pgm') && r.src !== g).map(r => r.src);
    const c = this.screen.items.length;
    const parts = [
      out.length ? `▶ TALKING TO ${out.map(nm).join(', ')}` : '▶ TALK: no key on',
      inn.length ? `◀ HEARING ${inn.map(nm).join(', ')}` : '◀ HEARING: nobody',
      `${c} said in 10 min`,
    ];
    const text = parts.join('   ·   ');
    const fs = 3.6;
    const scroll = Array.from(text).length * fs * 0.6 > w - 2;
    const lineEl = scroll
      ? (() => {
        const id = `m26tk${this.gid}`;
        const tw = Array.from(text).length * fs * 0.6;
        return svg('g', { 'clip-path': `url(#${id})` }, svg('clipPath', { id }, svg('rect', { x: x + 1, y, width: w - 2, height: h })),
          svg('text', { x: x + 1, y: y + h / 2 + 1.3, class: 'm26-led m26-ticker-t m26-mq', 'font-size': fs,
            style: `--dx:${r2(-(tw - w + 3))}px;--dur:${r2(Math.max(4, tw / 6))}s` }, text));
      })()
      : svg('text', { x: x + 1.5, y: y + h / 2 + 1.3, class: 'm26-led m26-ticker-t', 'font-size': fs }, text);
    f.ticker.replaceChildren(lineEl);
    f.ticker.classList.toggle('live', out.length > 0);
  }

  // ---- producer talent strip --------------------------------------------------------------------------
  private talentGids(): number[] {
    return this.store.facilityPorts(this.store.facilityOf(this.gid)).filter(p => p.kind === 'ifb').map(p => p.gid).slice(0, 8);
  }

  private ifbSlot(t: number): number | null {
    const k = this.st?.keys.find(k => (k.kind === 'bus' && k.target === t && (k.mode ?? '').includes('T'))
      || (k.kind === 'ext' && k.targets?.length === 1 && k.targets[0] === t));
    return k ? k.slot : null;
  }

  private drawTalent(): [Element, number][] {
    const f = this.face;
    if (!f?.talent) return [];
    const box = f.layout.talent!;
    const gids = this.talentGids();
    const allW = 18;
    const tw = (box.w - allW - 2) / 8;
    this.talentEls = [];
    const kids: SVGElement[] = [];
    gids.forEach((g, i) => {
      const x = box.x + 1 + i * tw, y = box.y + 1;
      const m = this.store.personOf(g);
      const p = this.store.port(g);
      const slot = this.ifbSlot(g);
      const tile = svg('g', { class: 'm26-tal', 'data-gid': g });
      tile.append(svg('title', {}, `${m.emoji ?? ''} ${m.name ?? p?.mnemonic ?? ''} — ${m.role ?? ''} (${p?.label ?? ''})${slot === null ? '\nNo key on this panel talks to this IFB' : ''}`),
        svg('rect', { x: x + 0.3, y, width: tw - 0.6, height: box.h - 2, rx: 1, class: 'm26-tal-bg' }),
        svg('text', { x: x + 1.5, y: y + 5, class: 'm26-tal-emoji' }, m.emoji ?? '🎤'),
        svg('text', { x: x + 6, y: y + 5, class: 'm26-led m26-tal-name' }, clip((m.name ?? p?.mnemonic ?? '').split(' ')[0], 9)),
        svg('text', { x: x + 1.5, y: y + 9.2, class: 'm26-tal-sub' }, `${p?.mnemonic.trim() ?? ''} · ${clip(m.role ?? '', 10)}`));
      const segs: SVGRectElement[] = [];
      const sw = (tw - 3) / VU_N;
      for (let s = 0; s < VU_N; s++) {
        const zone = s >= VU_N - 2 ? 'r' : s >= VU_N - 4 ? 'y' : 'g';
        const r = svg('rect', { x: r2(x + 1.5 + s * sw), y: y + 11, width: r2(sw - 0.5), height: 3.2, class: `tu-seg ${zone}` });
        segs.push(r);
        tile.append(r);
      }
      const lamps = ['MIC', 'CGH', 'IFB', 'PGM'];
      const lw = (tw - 3) / 4;
      lamps.forEach((l, j) => {
        tile.append(svg('rect', { x: r2(x + 1.5 + j * lw), y: y + 16, width: r2(lw - 0.6), height: 2.6, rx: 0.4, class: `m26-lamp l-${l.toLowerCase()}` }),
          svg('text', { x: r2(x + 1.5 + j * lw + (lw - 0.6) / 2), y: y + 21.4, class: 'm26-tal-l', 'text-anchor': 'middle' }, l));
      });
      // IFB talk paddle (bound by the keypanel to this station's key for the IFB, if any)
      const px = x + 3, py = y + 23.5, pw = tw - 6, ph = 12.5;
      const pad = svg('g', { class: `wb-key m26-talk${slot === null ? ' k-empty' : ''}`, role: 'button', 'aria-label': `Talk to ${m.name ?? p?.label}` },
        svg('rect', { x: r2(px - 0.5), y: r2(py - 0.5), width: r2(pw + 1), height: ph + 1, rx: 0.8, fill: '#0b0b0c' }),
        svg('path', { class: 'wb-paddle', d: `M ${r2(px)} ${r2(py + 1.5)} L ${r2(px + pw)} ${r2(py + 1.5)} L ${r2(px + pw - 0.8)} ${r2(py + ph)} L ${r2(px + 0.8)} ${r2(py + ph)} Z` }),
        svg('rect', { class: 'wb-paddle-top', x: r2(px), y: r2(py), width: r2(pw), height: 3, rx: 0.5 }),
        svg('rect', { x: r2(px + pw / 2 - 1), y: r2(py + 4.5), width: 2, height: 2, class: 'wb-sled' }),
        svg('text', { x: r2(px + pw / 2), y: r2(py + 10.6), class: 'm26-talk-t', 'text-anchor': 'middle' }, slot === null ? '—' : 'TALK'));
      tile.append(pad);
      if (slot !== null) this.bindAll(pad, [slot]);
      kids.push(tile);
      this.talentEls.push({ gid: g, tile, segs, slot, pad });
    });
    // ALL TALENT: hold to talk to every talent this panel has an IFB key for
    const ax = box.x + box.w - allW - 0.5, ay = box.y + 1;
    const slots = this.talentEls.map(t => t.slot).filter((s): s is number => s !== null);
    const all = svg('g', { class: `wb-key m26-all${slots.length ? '' : ' k-empty'}`, role: 'button', 'aria-label': 'Talk to all talent (hold)' },
      svg('title', {}, `Hold: talk to all ${slots.length} talent IFBs this panel has keys for. Click: latch / unlatch all.`),
      svg('rect', { x: ax, y: ay, width: allW, height: box.h - 2, rx: 1, class: 'm26-tal-bg' }),
      svg('text', { x: ax + allW / 2, y: ay + 6, class: 'm26-led m26-all-t', 'text-anchor': 'middle' }, 'ALL'),
      svg('text', { x: ax + allW / 2, y: ay + 10.5, class: 'm26-led m26-all-t', 'text-anchor': 'middle' }, 'TALENT'),
      svg('rect', { x: ax + allW / 2 - 1, y: ay + 13, width: 2, height: 2, class: 'wb-sled' }),
      svg('rect', { x: ax + 2.5, y: ay + 17.5, width: allW - 5, height: 20, rx: 0.8, fill: '#0b0b0c' }),
      svg('path', { class: 'wb-paddle', d: `M ${ax + 3} ${ay + 19.5} L ${ax + allW - 3} ${ay + 19.5} L ${ax + allW - 3.8} ${ay + 37} L ${ax + 3.8} ${ay + 37} Z` }),
      svg('rect', { class: 'wb-paddle-top', x: ax + 3, y: ay + 18, width: allW - 6, height: 3.5, rx: 0.5 }),
      svg('text', { x: ax + allW / 2, y: ay + 31, class: 'm26-talk-t', 'text-anchor': 'middle' }, 'IFB'));
    this.bindAll(all, slots);
    kids.push(all);
    this.allBtn = all;
    f.talent.replaceChildren(...kids);
    this.updateTalent();
    return [];
  }

  /** Talk paddles (one IFB, or ALL TALENT): hold > 300 ms = momentary; click = latch (all on → all off). */
  private bindAll(btn: SVGGElement, slots: number[]) {
    if (!slots.length) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let held = false;
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      (btn as Element).setPointerCapture(e.pointerId);
      btn.classList.add('down');
      held = false;
      timer = setTimeout(() => { held = true; for (const s of slots) this.client.key(this.gid, s, 'press'); btn.classList.add('press'); }, 300);
    });
    const end = (cancel: boolean) => {
      if (!btn.classList.contains('down')) return;
      btn.classList.remove('down');
      if (timer) clearTimeout(timer);
      if (held) { for (const s of slots) this.client.key(this.gid, s, 'release'); btn.classList.remove('press'); }
      else if (!cancel) {
        const allOn = slots.every(s => this.store.isActive(this.gid, s));
        for (const s of slots) if (allOn || !this.store.isActive(this.gid, s)) this.client.key(this.gid, s, 'toggle');
      }
    };
    btn.addEventListener('pointerup', () => end(false));
    btn.addEventListener('pointercancel', () => end(true));
  }

  private updateTalent() {
    if (!this.talentEls.length) return;
    const s = this.store;
    for (const t of this.talentEls) {
      const st = s.talentOf(t.gid);
      const into = s.byDst.get(t.gid) ?? [];
      const ifb = into.some(r => TALK_KINDS.has(r.kind) && r.gain > 0);
      const pgm = into.some(r => r.kind === 'pgm' && r.gain > 0);
      const lit = vuSegments(s.levels.get(t.gid) ?? 0, VU_N);
      t.segs.forEach((r, i) => r.classList.toggle('on', i < lit));
      const lamp = (cls: string, on: boolean) => t.tile.querySelector(`.l-${cls}`)?.classList.toggle('on', on);
      lamp('mic', st.mic && !st.cough);
      lamp('cgh', st.cough);
      lamp('ifb', ifb);
      lamp('pgm', pgm);
      t.tile.classList.toggle('talking', lit > 2 && st.mic && !st.cough);
      t.pad.classList.toggle('latch', t.slot !== null && s.isActive(this.gid, t.slot) === 'latch');
      t.pad.classList.toggle('press', t.slot !== null && s.isActive(this.gid, t.slot) === 'press');
    }
    if (this.allBtn) {
      const slots = this.talentEls.map(t => t.slot).filter((x): x is number => x !== null);
      this.allBtn.classList.toggle('latch', slots.length > 0 && slots.every(x => s.isActive(this.gid, x)));
    }
  }
}

const clip = (s: string, n: number) => (Array.from(s).length > n ? `${Array.from(s).slice(0, n - 1).join('')}…` : s);

