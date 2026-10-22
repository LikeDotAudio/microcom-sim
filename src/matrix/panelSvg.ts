// SVG emulation of Ward-Beck 7800-series intercom stations, modelled on a period product photo of a
// 2RU station: brushed light-grey faceplate with top vents, a green status LED over every key, a red
// LED alphanumeric strip showing each key's 4-character mnemonic, black paddle keys (1-n) and grey
// function keys (A-D), gooseneck mic with red/white buttons at the left, 4x4 keypad, WBS badge,
// speaker grille, two level knobs and a headset jack at the right.
// Key counts and grouping per model come from the MCOM software (specs/04-terminals.md §2.2).
import type { Station, StationKey } from './types';

const SVG = 'http://www.w3.org/2000/svg';
export const RACK_W = 482.6;
export const U = 44.45;

export interface KeyBox { slot: number; x: number; y: number; w: number; h: number; fn: boolean; key: StationKey }
export interface PanelUnit {
  model: string; units: number; y: number; style: 'rack' | 'desk' | 'expansion' | 'virtual';
  mic: boolean; keypad: boolean; speaker: boolean; title: string;
  keys: KeyBox[]; groups: { x: number; w: number; fn: boolean; y: number }[];
  keyX0: number; keyX1: number;
}
export interface PanelLayout { width: number; height: number; units: PanelUnit[] }

interface Section { fn: boolean; keys: StationKey[] }
interface UnitSpec {
  model: string; units: number; style: PanelUnit['style'];
  mic: boolean; keypad: boolean; speaker: boolean; title: string;
  rows: Section[][];                  // each row: key groups left to right (16 keys max per row)
}

/** Matrix-only station models (engine PANEL_MODELS) and their key counts. */
export const PANEL_MODELS: Record<string, number> = { M7832: 32, M7864: 64, M2026: 32, M2026P: 32 };
/** Picker descriptions of the matrix-only models. */
export const PANEL_MODEL_NAMES: Record<string, string> = {
  M7832: 'M7832 — 32 keys', M7864: 'M7864 — 64 keys',
  M2026: 'M2026 — MicroCOM 2026 station', M2026P: 'M2026P — MicroCOM 2026 producer',
};
/** MicroCOM 2026 models are drawn by src/m2026 (screens, map), not by renderPanel. */
export const isM2026 = (model: string | null | undefined) => model === 'M2026' || model === 'M2026P';
export const ROW_PITCH = 48;          // key row spacing (mm); each extra row adds one rack unit

/** Model names of the units a terminal type is made of (main station + expansion). */
export function unitModels(type: string, typeName: string): [string, string | null] {
  switch (type) {
    case '2': return ['M7880', 'M7881'];
    case '5': return ['M7880/F', null];
    case '6': return ['M7880D/F', null];
    case '7': return ['M7882', null];
    case '8': return ['M7884', null];
    default: return [typeName || 'PORT', null];
  }
}

const chunk = <T>(xs: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

function specsFor(st: Station): UnitSpec[] {
  const real = st.keys.filter(k => k.kind !== 'ext');
  const ext = st.keys.filter(k => k.kind === 'ext');
  const title = st.mnemonic.trim() || st.label;
  const cap = st.panelModel ? PANEL_MODELS[st.panelModel] ?? 0 : 0;
  if (cap) {
    // M7832 / M7864: MCOM-programmed keys first, then matrix keys, then blank keys; rows of 16
    const seq: StationKey[] = [...real.filter(k => k.kind !== 'empty'), ...ext].slice(0, cap)
      .map((k, i) => ({ ...k, label: String(i + 1) }));
    while (seq.length < cap) seq.push({ slot: -1 - seq.length, label: String(seq.length + 1), kind: 'empty', name: '', on: null });
    const rows = chunk(seq, 16).map(r => [{ fn: false, keys: r }]);
    return [{ model: st.panelModel!, units: 2 + rows.length - 1, style: 'rack', mic: true, keypad: true,
      speaker: true, title, rows }];
  }
  const isAD = (k: StationKey) => /^[A-D]$/.test(k.label);
  const isExp = (k: StationKey) => k.label.startsWith('2:') || (st.type === '2' && Number(k.label) >= 7);
  const main = real.filter(k => !isAD(k) && !isExp(k));
  const ad = real.filter(isAD);
  const exp = real.filter(isExp);
  const [m1, m2] = unitModels(st.type, st.typeName);
  const out: UnitSpec[] = [];
  const first: Section[] = [{ fn: false, keys: main }, { fn: true, keys: ad }];
  if (st.type === '5' || st.type === '6') {
    // M7880/F, M7880D/F: one 3RU station, second key row = the 16 "F" keys
    out.push({ model: m1, units: 3, style: 'rack', mic: true, keypad: true, speaker: true, title,
      rows: [first, [{ fn: false, keys: exp }]] });
  } else if (st.type === '7' || st.type === '8') {
    out.push({ model: m1, units: 2, style: 'desk', mic: true, keypad: true, speaker: true, title, rows: [first] });
  } else if (st.type && st.type !== '0') {
    out.push({ model: m1, units: 2, style: 'rack', mic: true, keypad: true, speaker: true, title, rows: [first] });
    if (exp.length && m2) {
      out.push({ model: m2, units: 2, style: 'expansion', mic: false, keypad: false, speaker: false,
        title: 'EXPANSION', rows: [[{ fn: false, keys: exp }]] });
    }
  } else if (real.some(k => k.kind !== 'empty')) {
    out.push({ model: 'PORT', units: 2, style: 'rack', mic: false, keypad: false, speaker: false, title,
      rows: [[{ fn: false, keys: real.filter(k => k.kind !== 'empty') }]] });
  }
  if (ext.length) {
    const rows = chunk(ext, 16).map(r => [{ fn: false, keys: r }]);
    out.push({ model: 'MATRIX EXT', units: 2 + rows.length - 1, style: 'virtual', mic: false, keypad: false,
      speaker: false, title: 'CROSS-FACILITY', rows });
  }
  return out;
}

/** Pure geometry (mm, 19" rack coordinates): where each unit and key goes. */
export function layoutPanel(st: Station): PanelLayout {
  const units: PanelUnit[] = [];
  let y = 0;
  for (const s of specsFor(st)) {
    const h = s.units * U;
    const keyX0 = s.mic ? 66 : 30;
    const keyX1 = s.keypad ? 340 : RACK_W - 30;
    const gap = 7;
    // one pitch for the whole unit so rows line up
    const tightest = Math.min(...s.rows.map(r => {
      const secs = r.filter(sec => sec.keys.length);
      return { n: secs.reduce((a, sec) => a + sec.keys.length, 0), g: Math.max(0, secs.length - 1) };
    }).map(({ n, g }) => (n ? (keyX1 - keyX0 - gap * g) / n : 22)));
    const pitch = Math.min(22, tightest);
    const kw = pitch - 2.4;
    const kh = 21;
    const keys: KeyBox[] = [];
    const groups: PanelUnit['groups'] = [];
    s.rows.forEach((row, ri) => {
      const secs = row.filter(sec => sec.keys.length);
      const n = secs.reduce((a, sec) => a + sec.keys.length, 0);
      const ky = y + 44 + ri * ROW_PITCH;
      const used = pitch * n + gap * Math.max(0, secs.length - 1);
      let x = keyX0 + (keyX1 - keyX0 - used) / 2;
      for (const sec of secs) {
        const gx = x;
        for (const k of sec.keys) {
          keys.push({ slot: k.slot, x: x + 1.2, y: ky, w: kw, h: kh, fn: sec.fn, key: k });
          x += pitch;
        }
        groups.push({ x: gx, w: x - gx, fn: sec.fn, y: ky });
        x += gap;
      }
    });
    units.push({ model: s.model, units: s.units, y, style: s.style, mic: s.mic, keypad: s.keypad,
      speaker: s.speaker, title: s.title, keys, groups, keyX0, keyX1 });
    y += h + 3;
  }
  return { width: RACK_W, height: Math.max(y - 3, 2 * U), units };
}

// ---- rendering --------------------------------------------------------------------------------------

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {},
  ...kids: (SVGElement | string | null)[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const c of kids) if (c != null) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

export const r2 = (n: number) => Math.round(n * 100) / 100;

export function defs(): SVGDefsElement {
  const stops = (id: string, a: string, b: string, c?: string) => svg('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 },
    svg('stop', { offset: 0, 'stop-color': a }), ...(c ? [svg('stop', { offset: 0.55, 'stop-color': b })] : []),
    svg('stop', { offset: 1, 'stop-color': c ?? b }));
  return svg('defs', {},
    stops('wb-face', '#d9dcde', '#c4c8cb', '#aeb2b6'),
    stops('wb-face-desk', '#c9ccce', '#a3a7ab'),
    stops('wb-face-virtual', '#b8c6d4', '#8ea2b6'),
    stops('wb-paddle', '#4a4d52', '#1f2124', '#0b0c0d'),
    stops('wb-paddle-fn', '#e3e5e7', '#b3b7bb', '#8d9196'),
    stops('wb-pad', '#f1f2f3', '#c9cdd0'),
    svg('linearGradient', { id: 'wb-brush', x1: 0, y1: 0, x2: 1, y2: 0 },
      svg('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': 0.0 }),
      svg('stop', { offset: 0.5, 'stop-color': '#fff', 'stop-opacity': 0.18 }),
      svg('stop', { offset: 1, 'stop-color': '#fff', 'stop-opacity': 0.0 })),
    svg('radialGradient', { id: 'wb-knob', cx: 0.4, cy: 0.35, r: 0.75 },
      svg('stop', { offset: 0, 'stop-color': '#6a6e73' }), svg('stop', { offset: 1, 'stop-color': '#121315' })),
    svg('pattern', { id: 'wb-grille', width: 2.6, height: 2.6, patternUnits: 'userSpaceOnUse' },
      svg('rect', { width: 2.6, height: 2.6, fill: '#1c1d1f' }),
      svg('circle', { cx: 1.3, cy: 1.3, r: 0.75, fill: '#050505' })),
    svg('filter', { id: 'wb-glow', x: -1, y: -1, width: 3, height: 3 },
      svg('feGaussianBlur', { stdDeviation: 0.9, result: 'b' }),
      svg('feMerge', {}, svg('feMergeNode', { in: 'b' }), svg('feMergeNode', { in: 'SourceGraphic' }))));
}

export function rackEars(g: SVGGElement, y: number, h: number) {
  for (const x of [7.5, RACK_W - 7.5]) {
    for (const hy of [y + 7.5, y + h - 7.5]) {
      g.append(svg('circle', { cx: x, cy: hy, r: 3.2, fill: '#3a3c3f', stroke: '#8f9397', 'stroke-width': 0.5 }),
        svg('circle', { cx: x - 0.4, cy: hy - 0.4, r: 2.4, fill: '#16171a' }));
    }
  }
}

function vents(g: SVGGElement, x0: number, x1: number, y: number) {
  for (let row = 0; row < 3; row++) {
    for (let x = x0; x < x1 - 7; x += 9) {
      g.append(svg('rect', { x: r2(x + (row % 2) * 4.5), y: r2(y + row * 4.2), width: 7, height: 2.2, rx: 1.1,
        fill: '#3d4044', opacity: 0.85 }));
    }
  }
}

export function micBlock(g: SVGGElement, y: number) {
  // gooseneck: socket at the lower left, flexible shaft curving out and down to the left (as in the photo)
  const sx = 22, sy = y + 62;
  g.append(svg('circle', { cx: sx, cy: sy, r: 6.5, fill: '#2b2d30', stroke: '#e5e7e9', 'stroke-width': 0.8 }),
    svg('path', { d: `M ${sx} ${sy} C ${sx - 2} ${sy - 18}, ${sx - 12} ${sy - 22}, ${sx - 16} ${sy - 4}`,
      stroke: '#6b6f74', 'stroke-width': 3.2, fill: 'none', 'stroke-linecap': 'round' }),
    svg('path', { d: `M ${sx} ${sy} C ${sx - 2} ${sy - 18}, ${sx - 12} ${sy - 22}, ${sx - 16} ${sy - 4}`,
      stroke: '#b9bdc1', 'stroke-width': 1.1, fill: 'none', 'stroke-dasharray': '0.6 0.9' }),
    svg('rect', { x: sx - 21, y: sy - 6, width: 9, height: 18, rx: 3, fill: '#9a9ea3', stroke: '#45484c',
      'stroke-width': 0.6, transform: `rotate(-12 ${sx - 16} ${sy})` }),
    svg('text', { x: sx, y: sy + 11, class: 'wb-silk', 'text-anchor': 'middle' }, 'MIC'));
  // status LED, red TALK button over white button
  const bx = 40;
  g.append(svg('rect', { x: bx + 3.2, y: y + 25.5, width: 2.6, height: 2.6, class: 'wb-sled' }),
    svg('rect', { x: bx - 1, y: y + 33, width: 11, height: 11, rx: 1, fill: '#121315' }),
    svg('rect', { x: bx, y: y + 34, width: 9, height: 9, rx: 0.8, fill: '#e3261b' }),
    svg('rect', { x: bx + 1, y: y + 35, width: 7, height: 3, rx: 0.6, fill: '#ff6a5c', opacity: 0.6 }),
    svg('rect', { x: bx - 1, y: y + 46, width: 11, height: 18, rx: 1, fill: '#121315' }),
    svg('rect', { x: bx, y: y + 47, width: 9, height: 16, rx: 0.8, fill: '#f4f4f2' }),
    svg('text', { x: bx + 4.5, y: y + 69.5, class: 'wb-silk', 'text-anchor': 'middle' }, 'TALK'));
}

function keypadBlock(g: SVGGElement, x: number, y: number) {
  g.append(svg('rect', { x: x - 3, y: y + 21, width: 2.6, height: 2.6, class: 'wb-sled on' }));
  const labels = ['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D'];
  labels.forEach((l, i) => {
    const cx = x + 4 + (i % 4) * 8.6, cy = y + 30 + Math.floor(i / 4) * 9.4;
    g.append(svg('rect', { x: cx - 0.5, y: cy - 0.5, width: 8, height: 8.4, rx: 0.8, fill: '#2c2e31' }),
      svg('rect', { x: cx, y: cy, width: 7, height: 7.4, rx: 0.7, fill: 'url(#wb-pad)' }),
      svg('text', { x: cx + 3.5, y: cy + 5.2, class: 'wb-pad', 'text-anchor': 'middle' }, l));
  });
}

function rightBlock(g: SVGGElement, y: number, model: string) {
  // WBS badge + model above the speaker
  const bx = 386;
  g.append(svg('rect', { x: bx, y: y + 21, width: 14, height: 6, rx: 0.8, fill: 'none', stroke: '#2a2c2f', 'stroke-width': 0.6 }),
    svg('text', { x: bx + 7, y: y + 25.4, class: 'wb-badge', 'text-anchor': 'middle' }, 'WBS'),
    svg('text', { x: bx + 17, y: y + 25.6, class: 'wb-modeltxt' }, model));
  // speaker grille
  g.append(svg('rect', { x: bx - 1, y: y + 30, width: 46, height: 40, rx: 4, fill: '#2a2c2f' }),
    svg('rect', { x: bx + 1, y: y + 32, width: 42, height: 36, rx: 3, fill: 'url(#wb-grille)' }));
  // two knobs and headset jack
  const kx = 455;
  for (const [ky, lbl] of [[y + 25, 'SPEAKER'], [y + 47, 'MIC']] as [number, string][]) {
    g.append(svg('text', { x: kx, y: ky - 6.5, class: 'wb-silk', 'text-anchor': 'middle' }, lbl));
    for (let i = 0; i <= 10; i++) {
      const a = (-135 + i * 27) * Math.PI / 180;
      g.append(svg('line', { x1: r2(kx + Math.sin(a) * 6.3), y1: r2(ky - Math.cos(a) * 6.3),
        x2: r2(kx + Math.sin(a) * 7.4), y2: r2(ky - Math.cos(a) * 7.4), stroke: '#2a2c2f', 'stroke-width': 0.35 }));
    }
    g.append(svg('circle', { cx: kx, cy: ky, r: 5.2, fill: 'url(#wb-knob)', stroke: '#070707', 'stroke-width': 0.5 }),
      svg('line', { x1: kx, y1: ky - 4.4, x2: kx + 1.4, y2: ky - 2.2, stroke: '#eee', 'stroke-width': 0.8, 'stroke-linecap': 'round' }));
  }
  g.append(svg('circle', { cx: kx, cy: y + 70, r: 3.6, fill: '#1a1b1d', stroke: '#e0e2e4', 'stroke-width': 0.7 }),
    svg('circle', { cx: kx, cy: y + 70, r: 1.6, fill: '#000' }),
    svg('text', { x: kx, y: y + 78.5, class: 'wb-silk', 'text-anchor': 'middle' }, 'HEADSET'));
}

export function keyMode(k: StationKey): string {
  if (k.kind === 'bus') return k.mode ?? '';
  if (k.kind === 'ext') return 'TL';
  if (k.kind === 'phantom') return k.name.replace(/\d+$/, '');
  return '';
}

function keyGroup(b: KeyBox, title: string): SVGGElement {
  const k = b.key;
  const g = svg('g', { class: `wb-key k-${k.kind}${b.fn ? ' fn' : ''}`, 'data-slot': b.slot, role: 'button',
    'aria-label': `${k.label} ${k.name.trim()}`.trim() });
  const cx = b.x + b.w / 2;
  const legend = k.kind === 'empty' ? '' : k.name.trim().slice(0, 4).toUpperCase();
  const fs = Math.min(4.6, b.w / 3.2);
  const top = b.y;
  g.append(svg('title', {}, title),
    // green status LED (lit while the key is on)
    svg('rect', { x: r2(cx - 1.4), y: top - 18.5, width: 2.8, height: 2.8, class: 'wb-sled' }),
    // red LED alphanumeric legend for this key (sits on the common display strip)
    svg('text', { x: r2(cx), y: r2(top - 6.6), class: 'wb-alnum', 'text-anchor': 'middle', 'font-size': r2(fs),
      textLength: legend ? r2(Math.min(b.w - 1.5, fs * 3.4)) : 0, lengthAdjust: 'spacingAndGlyphs' }, legend),
    // paddle key: dark slot, sloped paddle face, highlight edge
    svg('rect', { x: b.x - 0.6, y: top - 0.6, width: b.w + 1.2, height: b.h + 1.2, rx: 0.8, fill: '#0b0b0c' }),
    svg('path', { class: 'wb-paddle', d: `M ${r2(b.x)} ${r2(top + 2)} L ${r2(b.x + b.w)} ${r2(top + 2)} ` +
      `L ${r2(b.x + b.w - 0.8)} ${r2(top + b.h)} L ${r2(b.x + 0.8)} ${r2(top + b.h)} Z` }),
    svg('rect', { class: 'wb-paddle-top', x: r2(b.x), y: r2(top), width: r2(b.w), height: 4, rx: 0.6 }),
    // number under the key, followed by the key function in small print
    svg('text', { x: r2(cx), y: r2(top + b.h + 4.8), class: 'wb-silk wb-num', 'text-anchor': 'middle' },
      k.label.replace(/^2:/, ''), svg('tspan', { class: 'wb-fn', dx: 0.8 }, keyMode(k))));
  return g;
}

/** Build the whole station as one SVG; `titleOf` supplies each key's tooltip. */
export function renderPanel(st: Station, titleOf: (k: StationKey) => string): { svg: SVGSVGElement; keys: Map<number, SVGGElement> } {
  const L = layoutPanel(st);
  const root = svg('svg', { viewBox: `0 0 ${RACK_W} ${r2(L.height)}`, class: 'wb-panel', role: 'group',
    'aria-label': `${st.typeName || 'port'} ${st.mnemonic}`, preserveAspectRatio: 'xMidYMin meet' }, defs());
  const keys = new Map<number, SVGGElement>();
  for (const u of L.units) {
    const h = u.units * U;
    const g = svg('g', { class: `wb-unit wb-${u.style}` });
    const desk = u.style === 'desk';
    const fill = desk ? 'url(#wb-face-desk)' : u.style === 'virtual' ? 'url(#wb-face-virtual)' : 'url(#wb-face)';
    const fx = desk ? 14 : 0, fw = desk ? RACK_W - 28 : RACK_W;
    if (desk) g.append(svg('path', { d: `M ${fx - 6} ${u.y + h} L ${fx} ${u.y + 3} L ${fx + fw} ${u.y + 3} L ${fx + fw + 6} ${u.y + h} Z`, fill: '#5a5e62' }));
    g.append(svg('rect', { x: fx, y: u.y + (desk ? 3 : 0), width: fw, height: h - (desk ? 3 : 0), rx: 1.6, fill,
      stroke: '#7d8185', 'stroke-width': 0.7 }),
      svg('rect', { x: fx, y: u.y, width: fw, height: h, fill: 'url(#wb-brush)', opacity: 0.5 }));
    if (!desk) rackEars(g, u.y, h);
    vents(g, u.keyX0 - 4, u.keyX1 + (u.keypad ? -2 : 0), u.y + 6);
    if (u.mic) micBlock(g, u.y);
    if (u.keypad) keypadBlock(g, 346, u.y);
    if (u.speaker) rightBlock(g, u.y, u.model);
    else {
      g.append(svg('text', { x: RACK_W - 30, y: u.y + 22, class: 'wb-modeltxt', 'text-anchor': 'end' }, u.model),
        svg('text', { x: RACK_W - 30, y: u.y + 27, class: 'wb-silk', 'text-anchor': 'end' }, u.title));
    }
    // station identity on the faceplate (engraved label strip above the vents' right end)
    if (u.speaker) g.append(svg('text', { x: u.keyX0, y: u.y + 22.6, class: 'wb-ident' }, u.title.slice(0, 22)));
    // red LED display strip spanning each key group
    for (const grp of u.groups) {
      g.append(svg('rect', { x: r2(grp.x + 0.4), y: r2(grp.y - 13), width: r2(grp.w - 0.8), height: 8.6, rx: 0.8,
        class: 'wb-strip' }));
    }
    for (const b of u.keys) {
      const kg = keyGroup(b, titleOf(b.key));
      keys.set(b.slot, kg);
      g.append(kg);
    }
    root.append(g);
  }
  return { svg: root, keys };
}
