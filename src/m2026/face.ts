// MicroCOM 2026 faceplate (M2026 station, M2026P producer): the 7800-series look — brushed 19" plate,
// gooseneck mic, paddle keys with red LED legends — with the vent grille turned into a 'recently said'
// screen, the speaker grille into a map, per-key 3-line LED windows (emoji, name, role) and the 4x4 keypad
// relabelled for map/screen navigation. Pure geometry in layoutM2026; DOM in renderFace.
import { defs, keyMode, micBlock, r2, RACK_W, rackEars, svg, U } from '../matrix/panelSvg';
import type { Station, StationKey } from '../matrix/types';
import { keyLegend, ledChars, type KeyLegend } from './labels';

export interface Box { x: number; y: number; w: number; h: number }
export interface KeyCell { slot: number; key: StationKey; win: Box; paddle: Box; n: number }
export interface M26Layout {
  producer: boolean; units: number; height: number;
  ident: Box; screen: Box; talent: Box | null; keys: KeyCell[]; ticker: Box;
  prod: Box; map: Box; pad: Box; knobs: Box; micY: number;
}

export const KEYS = 32;
export const PER_ROW = 16;
const KX0 = 64, KX1 = 346;          // key / screen area
const RX0 = 349, RX1 = 470;         // right zone (map, keypad)
export const LED_FS = 3.1;

/** The 32 keys in order: MCOM-programmed keys, then matrix keys, then blanks (as M7832). */
export function m2026Keys(st: Station): StationKey[] {
  const real = st.keys.filter(k => k.kind !== 'ext' && k.kind !== 'empty');
  const ext = st.keys.filter(k => k.kind === 'ext');
  const seq = [...real, ...ext].slice(0, KEYS).map((k, i) => ({ ...k, label: String(i + 1) }));
  while (seq.length < KEYS) seq.push({ slot: -1 - seq.length, label: String(seq.length + 1), kind: 'empty', name: '', on: null });
  return seq;
}

export function layoutM2026(st: Station, producer: boolean): M26Layout {
  const units = producer ? 5 : 4;
  const H = units * U;
  const off = producer ? 46 : 0;
  const pitch = (KX1 - KX0) / PER_ROW;
  const kw = pitch - 1.6;
  const keys = m2026Keys(st).map((key, i) => {
    const row = Math.floor(i / PER_ROW), col = i % PER_ROW;
    const x = KX0 + col * pitch + 0.8;
    const wy = 62 + off + row * 46;
    return { slot: key.slot, key, n: i + 1, win: { x, y: wy, w: kw, h: 17 }, paddle: { x, y: wy + 19, w: kw, h: 18 } };
  });
  return {
    producer, units, height: H,
    ident: { x: 13, y: 9, w: 47, h: H - 92 },
    screen: { x: KX0, y: 7, w: KX1 - KX0, h: 50 },
    talent: producer ? { x: KX0, y: 61, w: KX1 - KX0, h: 42 } : null,
    keys,
    ticker: { x: KX0, y: 155 + off, w: KX1 - KX0, h: 9 },
    prod: { x: RX0, y: 7, w: RX1 - RX0, h: 10 },
    map: { x: RX0, y: 19, w: RX1 - RX0, h: H - 19 - 64 },
    pad: { x: RX0, y: H - 60, w: 47, h: 47 },
    knobs: { x: RX0 + 52, y: H - 60, w: RX1 - RX0 - 52, h: 47 },
    micY: H - 80,
  };
}

/** Keypad legends (row-major) and the action each key performs. */
export const PAD: [string, string][] = [
  ['HERE', 'here'], ['▲', 'up'], ['THERE', 'there'], ['ZM+', 'zin'],
  ['◀', 'left'], ['OK', 'ok'], ['▶', 'right'], ['ZM−', 'zout'],
  ['WORLD', 'every'], ['▼', 'down'], ['ME', 'me'], ['MAP', 'map'],
  ['◀PRD', 'prdprev'], ['ACK', 'ack'], ['PRD▶', 'prdnext'], ['PLAY', 'play'],
];

export interface FaceHandles {
  svg: SVGSVGElement;
  layout: M26Layout;
  keys: Map<number, SVGGElement>;
  legends: Map<number, SVGGElement>;
  screen: SVGSVGElement;
  map: SVGSVGElement;
  prod: SVGGElement;
  ticker: SVGGElement;
  talent: SVGGElement | null;
  ident: SVGGElement;
  pad: Map<string, SVGGElement>;
}

let clipSeq = 0;

/** A line of LED text that scrolls back and forth when it does not fit (CSS marquee on the text). */
export function ledLine(text: string, x: number, y: number, w: number, fs: number, cls: string, scroll: boolean, anchor: 'start' | 'middle' | 'end' = 'middle'): SVGElement {
  if (!scroll) {
    const ax = anchor === 'middle' ? x + w / 2 : anchor === 'end' ? x + w : x;
    return svg('text', { x: r2(ax), y: r2(y), class: cls, 'font-size': fs, 'text-anchor': anchor }, text);
  }
  const id = `m26c${++clipSeq}`;
  const tw = Array.from(text).length * fs * 0.6;
  const g = svg('g', { 'clip-path': `url(#${id})` },
    svg('clipPath', { id }, svg('rect', { x: r2(x), y: r2(y - fs), width: r2(w), height: r2(fs * 1.4) })));
  const t = svg('text', { x: r2(x), y: r2(y), class: `${cls} m26-mq`, 'font-size': fs, 'text-anchor': 'start',
    style: `--dx:${r2(-(tw - w + 0.6))}px;--dur:${r2(Math.max(3, tw / 4))}s` }, text);
  g.append(t);
  return g;
}

/** The 3-line LED window of one key: status LED + emoji + mnemonic / name / role. */
export function legendGroup(b: KeyCell, lg: KeyLegend): SVGGElement {
  const { x, y, w } = b.win;
  const fs = LED_FS;
  const g = svg('g', { class: 'm26-legend' });
  g.append(
    ledLine(lg.top, x + 1, y + 5, w - 2, fs * 0.92, 'm26-led m26-mn', false, 'end'),
    ...(lg.emoji ? [svg('text', { x: r2(x + 3.4), y: r2(y + 5.1), class: 'm26-emoji', 'font-size': 3.4 }, lg.emoji)] : []),
    ledLine(lg.name, x + 0.6, y + 10.4, w - 1.2, fs, 'm26-led m26-name', lg.scrollName),
    ledLine(lg.role, x + 0.6, y + 15.3, w - 1.2, fs * 0.84, 'm26-led m26-role', lg.scrollRole));
  return g;
}

function keyCell(b: KeyCell, lg: KeyLegend, title: string): { g: SVGGElement; legend: SVGGElement } {
  const k = b.key;
  const g = svg('g', { class: `wb-key m26-key k-${k.kind}`, 'data-slot': b.slot, role: 'button',
    'aria-label': `${b.n} ${lg.full}`.trim() });
  const { x, y, w, h } = b.win;
  const p = b.paddle;
  const legend = legendGroup(b, lg);
  g.append(svg('title', {}, title),
    svg('rect', { x: r2(x - 0.4), y: r2(y - 0.4), width: r2(w + 0.8), height: r2(h + 0.8), rx: 1, class: 'm26-bezel' }),
    svg('rect', { x: r2(x), y: r2(y), width: r2(w), height: r2(h), rx: 0.7, class: 'm26-win' }),
    svg('rect', { x: r2(x + 0.9), y: r2(y + 1.2), width: 2, height: 2, class: 'wb-sled' }),
    legend,
    svg('rect', { x: r2(p.x - 0.6), y: r2(p.y - 0.6), width: r2(p.w + 1.2), height: r2(p.h + 1.2), rx: 0.8, fill: '#0b0b0c' }),
    svg('path', { class: 'wb-paddle', d: `M ${r2(p.x)} ${r2(p.y + 2)} L ${r2(p.x + p.w)} ${r2(p.y + 2)} ` +
      `L ${r2(p.x + p.w - 0.8)} ${r2(p.y + p.h)} L ${r2(p.x + 0.8)} ${r2(p.y + p.h)} Z` }),
    svg('rect', { class: 'wb-paddle-top', x: r2(p.x), y: r2(p.y), width: r2(p.w), height: 4, rx: 0.6 }),
    svg('text', { x: r2(p.x + p.w / 2), y: r2(p.y + p.h + 4.2), class: 'wb-silk wb-num', 'text-anchor': 'middle' },
      String(b.n), svg('tspan', { class: 'wb-fn', dx: 0.8 }, keyMode(k))));
  return { g, legend };
}

function knob(g: SVGGElement, kx: number, ky: number, lbl: string) {
  g.append(svg('text', { x: kx, y: ky - 7, class: 'wb-silk', 'text-anchor': 'middle' }, lbl));
  for (let i = 0; i <= 10; i++) {
    const a = (-135 + i * 27) * Math.PI / 180;
    g.append(svg('line', { x1: r2(kx + Math.sin(a) * 5.6), y1: r2(ky - Math.cos(a) * 5.6),
      x2: r2(kx + Math.sin(a) * 6.6), y2: r2(ky - Math.cos(a) * 6.6), stroke: '#2a2c2f', 'stroke-width': 0.35 }));
  }
  g.append(svg('circle', { cx: kx, cy: ky, r: 4.6, fill: 'url(#wb-knob)', stroke: '#070707', 'stroke-width': 0.5 }),
    svg('line', { x1: kx, y1: ky - 3.8, x2: kx + 1.2, y2: ky - 1.9, stroke: '#eee', 'stroke-width': 0.7, 'stroke-linecap': 'round' }));
}

/** Screen bezel: dark glass framed by the old vent slots (a nod to the grille it replaces). */
function bezel(g: SVGGElement, b: Box, cls: string) {
  g.append(svg('rect', { x: r2(b.x - 1.6), y: r2(b.y - 1.6), width: r2(b.w + 3.2), height: r2(b.h + 3.2), rx: 2.2, class: 'm26-frame' }),
    svg('rect', { x: r2(b.x - 0.5), y: r2(b.y - 0.5), width: r2(b.w + 1), height: r2(b.h + 1), rx: 1.2, class: `m26-glass ${cls}` }));
}

export function renderFace(st: Station, producer: boolean, legendOf: (k: StationKey, maxChars: number) => KeyLegend,
  titleOf: (k: StationKey) => string): FaceHandles {
  const L = layoutM2026(st, producer);
  const H = L.height;
  const model = producer ? 'M2026P' : 'M2026';
  const root = svg('svg', { viewBox: `0 0 ${RACK_W} ${r2(H)}`, class: `wb-panel m26-panel${producer ? ' m26-producer' : ''}`,
    role: 'group', 'aria-label': `${model} ${st.mnemonic}`, preserveAspectRatio: 'xMidYMin meet' }, defs());
  root.querySelector('defs')!.append(
    svg('pattern', { id: 'm26-slots', width: 9, height: 4.2, patternUnits: 'userSpaceOnUse' },
      svg('rect', { x: 1, y: 1, width: 7, height: 2.2, rx: 1.1, fill: '#3d4044', opacity: 0.55 })),
    svg('radialGradient', { id: 'm26-sea', cx: 0.42, cy: 0.38, r: 0.7 },
      svg('stop', { offset: 0, 'stop-color': '#0f2c3a' }), svg('stop', { offset: 1, 'stop-color': '#04121a' })));
  const g = svg('g', { class: 'wb-unit wb-rack' });
  g.append(svg('rect', { x: 0, y: 0, width: RACK_W, height: H, rx: 1.6, fill: 'url(#wb-face)', stroke: '#7d8185', 'stroke-width': 0.7 }),
    svg('rect', { x: 0, y: 0, width: RACK_W, height: H, fill: 'url(#wb-brush)', opacity: 0.5 }));
  rackEars(g, 0, H);
  // vent-slot texture around the screen (the grille it replaced)
  g.append(svg('rect', { x: L.screen.x - 4, y: 2.5, width: L.screen.w + 8, height: L.screen.h + 9, fill: 'url(#m26-slots)', opacity: 0.6 }));
  bezel(g, L.screen, 'm26-said-glass');
  if (L.talent) bezel(g, L.talent, 'm26-talent-glass');
  bezel(g, L.map, 'm26-map-glass');
  bezel(g, L.ticker, 'm26-ticker-glass');
  // nested screens (their own coordinate systems)
  const screen = svg('svg', { x: L.screen.x, y: L.screen.y, width: L.screen.w, height: L.screen.h,
    viewBox: `0 0 ${L.screen.w} ${L.screen.h}`, class: 'm26-screen', overflow: 'hidden' });
  const map = svg('svg', { x: L.map.x, y: L.map.y, width: L.map.w, height: L.map.h,
    viewBox: `0 0 ${L.map.w} ${r2(L.map.h)}`, class: 'm26-map', overflow: 'hidden' });
  const talent = L.talent ? svg('g', { class: 'm26-talent' }) : null;
  const ticker = svg('g', { class: 'm26-ticker' });
  const prod = svg('g', { class: 'm26-prod' });
  const ident = svg('g', { class: 'm26-ident', role: 'button', 'aria-label': 'Station name (click to set your name and emoji)' });
  g.append(screen, map, ticker, prod, ident);
  if (talent) g.append(talent);
  // identity, mic, keypad, knobs, badge
  micBlock(g, L.micY);
  const pad = new Map<string, SVGGElement>();
  PAD.forEach(([lbl, act], i) => {
    const px = L.pad.x + (i % 4) * 11.8, py = L.pad.y + Math.floor(i / 4) * 11.8;
    const b = svg('g', { class: `m26-pad a-${act}`, role: 'button', 'aria-label': lbl, 'data-act': act },
      svg('rect', { x: px - 0.5, y: py - 0.5, width: 11, height: 11, rx: 1, fill: '#2c2e31' }),
      svg('rect', { x: px, y: py, width: 10, height: 10, rx: 0.9, class: 'm26-padcap' }),
      svg('text', { x: px + 5, y: py + 6.3, class: 'm26-padtxt', 'text-anchor': 'middle',
        'font-size': Array.from(lbl).length > 3 ? 2.3 : lbl.length > 1 ? 2.8 : 4 }, lbl));
    pad.set(act, b);
    g.append(b);
  });
  const kx = L.knobs.x;
  knob(g, kx + 7, L.knobs.y + 10, 'SPEAKER');
  knob(g, kx + 26, L.knobs.y + 10, 'MIC');
  g.append(svg('circle', { cx: kx + 45, cy: L.knobs.y + 10, r: 3.4, fill: '#1a1b1d', stroke: '#e0e2e4', 'stroke-width': 0.7 }),
    svg('circle', { cx: kx + 45, cy: L.knobs.y + 10, r: 1.5, fill: '#000' }),
    svg('text', { x: kx + 45, y: L.knobs.y + 3, class: 'wb-silk', 'text-anchor': 'middle' }, 'HEADSET'),
    svg('rect', { x: kx + 2, y: L.knobs.y + 26, width: 14, height: 6, rx: 0.8, fill: 'none', stroke: '#2a2c2f', 'stroke-width': 0.6 }),
    svg('text', { x: kx + 9, y: L.knobs.y + 30.4, class: 'wb-badge', 'text-anchor': 'middle' }, 'WBS'),
    svg('text', { x: kx + 19, y: L.knobs.y + 30.6, class: 'wb-modeltxt' }, model),
    svg('text', { x: kx + 2, y: L.knobs.y + 37, class: 'wb-silk' }, producer ? 'MICROCOM 2026 PRODUCER' : 'MICROCOM 2026'));
  // keys
  const keys = new Map<number, SVGGElement>();
  const legends = new Map<number, SVGGElement>();
  const max = ledChars(L.keys[0].win.w - 1.2, LED_FS);
  for (const b of L.keys) {
    const { g: kg, legend } = keyCell(b, legendOf(b.key, max), titleOf(b.key));
    keys.set(b.slot, kg);
    legends.set(b.slot, legend);
    g.append(kg);
  }
  root.append(g);
  return { svg: root, layout: L, keys, legends, screen, map, prod, ticker, talent, ident, pad };
}

/** Replace a key's legend in place (people metadata changed). */
export function updateLegend(h: FaceHandles, slot: number, lg: KeyLegend) {
  const old = h.legends.get(slot);
  const cell = h.layout.keys.find(k => k.slot === slot);
  if (!old || !cell) return;
  const nu = legendGroup(cell, lg);
  old.replaceWith(nu);
  h.legends.set(slot, nu);
  h.keys.get(slot)?.setAttribute('aria-label', `${cell.n} ${lg.full}`.trim());
}

export { keyLegend };
