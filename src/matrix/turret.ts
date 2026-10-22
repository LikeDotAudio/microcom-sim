// Talent turret for an IFB/Mic position, drawn after Ward-Beck's 97082 desk turret (Energy 108/CING and
// Telemedia layouts, archive drawings 97082L01/L02/M01): textured-beige sloped box, lamp strip, LED
// bargraph VU in the long panel cut-out, MIC ON / MIC OFF square buttons with lamp, COUGH button,
// HEADSET level knob, WBS badge. The talent's mic is a listen-only source; cough / MIC OFF mute it.
import { el } from './dom';
import type { Store } from './store';
import { TALK_KINDS } from './types';
import type { MatrixClient } from './ws';

const SVG = 'http://www.w3.org/2000/svg';
const W = 192, H = 165;                 // 7.55 in x 6.5 in, in mm
export const VU_SEGMENTS = 20;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {},
  ...kids: (SVGElement | string | null)[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const c of kids) if (c != null) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

/** VU bargraph: how many of the segments are lit for an RMS level (dBFS scale, -48..0). */
export function vuSegments(rms: number, n = VU_SEGMENTS): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(n, Math.round(((db + 48) / 48) * n)));
}

export class TurretView {
  readonly root: HTMLElement;
  /** local IFB earpiece level (0..1), applied by the page's audio */
  headset = 0.8;
  onHeadset: ((v: number) => void) | null = null;
  private svgEl: SVGSVGElement | null = null;
  private seg: SVGRectElement[] = [];
  private lamps: Record<string, SVGRectElement> = {};
  private micLed: SVGCircleElement | null = null;
  private knobPtr: SVGLineElement | null = null;
  private gid = 0;

  constructor(private store: Store, private client: MatrixClient) {
    this.root = el('div', { class: 'turret', tabindex: '0', 'aria-label': 'Talent turret (space = cough)' });
    this.root.addEventListener('keydown', e => {
      if (e.code === 'Space' && !e.repeat) { this.cough(true); e.preventDefault(); }
    });
    this.root.addEventListener('keyup', e => { if (e.code === 'Space') { this.cough(false); e.preventDefault(); } });
  }

  private cough(down: boolean) { if (this.gid) this.client.send({ t: 'talent', gid: this.gid, cough: down }); }
  private mic(on: boolean) { if (this.gid) this.client.send({ t: 'talent', gid: this.gid, mic: on }); }

  render(gid: number) {
    this.gid = gid;
    const p = this.store.port(gid);
    const st = this.store.station?.gid === gid ? this.store.station : null;
    const t = st?.talent;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'tu-svg', role: 'group', 'aria-label': `Turret ${p?.label ?? ''}` },
      svg('defs', {},
        svg('filter', { id: 'tu-tex', x: 0, y: 0, width: 1, height: 1 },
          svg('feTurbulence', { type: 'fractalNoise', baseFrequency: 1.4, numOctaves: 2, seed: 7, result: 'n' }),
          svg('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 0.25  0 0 0 0 0.2  0 0 0 0 0.12  0 0 0 .22 0', result: 'g' }),
          svg('feComposite', { in: 'g', in2: 'SourceGraphic', operator: 'in', result: 'gt' }),
          svg('feMerge', {}, svg('feMergeNode', { in: 'SourceGraphic' }), svg('feMergeNode', { in: 'gt' }))),
        svg('radialGradient', { id: 'tu-knob', cx: 0.4, cy: 0.35, r: 0.75 },
          svg('stop', { offset: 0, 'stop-color': '#5d5a54' }), svg('stop', { offset: 1, 'stop-color': '#121110' })),
        svg('radialGradient', { id: 'tu-cap', cx: 0.4, cy: 0.35, r: 0.8 },
          svg('stop', { offset: 0, 'stop-color': '#4a4743' }), svg('stop', { offset: 1, 'stop-color': '#151413' })),
        svg('filter', { id: 'tu-glow', x: -1, y: -1, width: 3, height: 3 },
          svg('feGaussianBlur', { stdDeviation: 0.8, result: 'b' }),
          svg('feMerge', {}, svg('feMergeNode', { in: 'b' }), svg('feMergeNode', { in: 'SourceGraphic' })))));
    // case: side lips, textured beige top, darker top band (as in the top view drawings)
    root.append(
      svg('rect', { x: 0, y: 0, width: W, height: H, rx: 2, fill: '#a99f8d' }),
      svg('rect', { x: 3, y: 0, width: W - 6, height: H, fill: '#d8ceb9', filter: 'url(#tu-tex)' }),
      svg('rect', { x: 3, y: 0, width: W - 6, height: 32, fill: '#cbc0a9', filter: 'url(#tu-tex)' }),
      svg('line', { x1: 3, y1: 32, x2: W - 3, y2: 32, stroke: '#8f8573', 'stroke-width': 0.6 }),
      svg('rect', { x: 60, y: H - 1, width: 14, height: 2, fill: '#6f675a' }),
      svg('rect', { x: 128, y: H - 1, width: 14, height: 2, fill: '#6f675a' }));
    // identity in the top band
    root.append(
      svg('text', { x: 10, y: 14, class: 'tu-name' }, (p?.mnemonic || 'IFB').toUpperCase()),
      svg('text', { x: 10, y: 24, class: 'tu-silk' }, `${p?.label ?? ''}${t?.ifb ? ` · IFB ${t.ifb}` : ''}`),
      svg('text', { x: W - 10, y: 24, class: 'tu-silk', 'text-anchor': 'end' },
        t?.pgm ? `PGM ${this.store.portName(t.pgm)}` : 'PGM —'));
    // lamp strip (1-4 windows in the drawing) -> IFB / PGM / MIC / COUGH
    const lampNames = ['IFB', 'PGM', 'MIC', 'COUGH'];
    const lx = 62, lw = 17.5;
    root.append(svg('rect', { x: lx - 2, y: 40, width: lw * 4 + 4, height: 7.5, fill: 'none', stroke: '#2b2824', 'stroke-width': 0.5 }));
    lampNames.forEach((n, i) => {
      root.append(svg('text', { x: lx + lw * i + lw / 2, y: 45.6, class: 'tu-silk', 'text-anchor': 'middle' }, n));
      const r = svg('rect', { x: lx + lw * i + 1, y: 50, width: lw - 2, height: 6.5, class: `tu-lamp l-${n.toLowerCase()}` });
      root.append(svg('rect', { x: lx + lw * i, y: 49, width: lw, height: 8.5, fill: '#2b2824' }), r);
      this.lamps[n] = r;
    });
    // VU bargraph in the long cut-out (0.360 x 2.767 in punch in 97082M01)
    const vx = 40, vy = 64, vw = 112, vh = 8.5;
    root.append(svg('rect', { x: vx - 1.5, y: vy - 1.5, width: vw + 3, height: vh + 3, rx: 0.8, fill: '#151413' }),
      svg('text', { x: vx - 4, y: vy + 6.2, class: 'tu-silk', 'text-anchor': 'end' }, 'VU'));
    this.seg = [];
    const sw = vw / VU_SEGMENTS;
    for (let i = 0; i < VU_SEGMENTS; i++) {
      const zone = i >= VU_SEGMENTS - 3 ? 'r' : i >= VU_SEGMENTS - 7 ? 'y' : 'g';
      const r = svg('rect', { x: vx + i * sw + 0.5, y: vy + 0.6, width: sw - 1, height: vh - 1.2, class: `tu-seg ${zone}` });
      root.append(r);
      this.seg.push(r);
    }
    ['-40', '-20', '-10', '-3', '0'].forEach(lbl => {
      const db = Number(lbl);
      root.append(svg('text', { x: vx + ((db + 48) / 48) * vw, y: vy + vh + 6, class: 'tu-silk tu-scale', 'text-anchor': 'middle' }, lbl));
    });
    // MIC ON / MIC OFF square buttons with lamp, COUGH where TALKBACK sits, HEADSET knob, badge
    const btn = (x: number, y: number, label: string, cls: string, above?: string) => {
      const g = svg('g', { class: `tu-btn ${cls}`, role: 'button', 'aria-label': label });
      g.append(svg('rect', { x, y, width: 25, height: 25, fill: '#e2d9c6', stroke: '#2b2824', 'stroke-width': 0.7 }),
        svg('circle', { cx: x + 12.5, cy: y + 12.5, r: 9.2, class: 'tu-cap' }),
        svg('text', { x: x + 12.5, y: y + 32, class: 'tu-lbl', 'text-anchor': 'middle' }, label));
      if (above) g.append(svg('text', { x: x + 12.5, y: y - 3, class: 'tu-lbl', 'text-anchor': 'middle' }, above));
      root.append(g);
      return g;
    };
    const on = btn(30, 92, '', 'b-on', 'ON');
    const off = btn(30, 127, 'MIC', 'b-off', 'OFF');
    const cough = btn(78, 127, 'COUGH', 'b-cough');
    this.micLed = svg('circle', { cx: 66, cy: 104.5, r: 2.6, class: 'tu-led' });
    root.append(svg('line', { x1: 55, y1: 104.5, x2: 63.4, y2: 104.5, stroke: '#2b2824', 'stroke-width': 0.5 }), this.micLed);
    on.addEventListener('click', () => this.mic(true));
    off.addEventListener('click', () => this.mic(false));
    cough.addEventListener('pointerdown', e => { e.preventDefault(); (cough as Element).setPointerCapture(e.pointerId); this.cough(true); });
    for (const ev of ['pointerup', 'pointercancel'] as const) cough.addEventListener(ev, () => this.cough(false));
    // headset knob (local earpiece level): drag up/down or wheel
    const kx = 152, ky = 104;
    for (let i = 0; i <= 10; i++) {
      const a = (-135 + i * 27) * Math.PI / 180;
      root.append(svg('line', { x1: kx + Math.sin(a) * 9.5, y1: ky - Math.cos(a) * 9.5, x2: kx + Math.sin(a) * 11.2,
        y2: ky - Math.cos(a) * 11.2, stroke: '#2b2824', 'stroke-width': 0.4 }));
    }
    const knob = svg('g', { class: 'tu-knob', role: 'slider', 'aria-label': 'Headset level' },
      svg('circle', { cx: kx, cy: ky, r: 8, fill: 'url(#tu-knob)', stroke: '#0b0b0a', 'stroke-width': 0.6 }));
    this.knobPtr = svg('line', { x1: kx, y1: ky, x2: kx, y2: ky - 7, stroke: '#eee', 'stroke-width': 1, 'stroke-linecap': 'round' });
    knob.append(this.knobPtr);
    root.append(knob, svg('text', { x: kx, y: ky + 17, class: 'tu-lbl', 'text-anchor': 'middle' }, 'HEADSET'));
    let dragY: number | null = null;
    const setLevel = (v: number) => { this.headset = Math.max(0, Math.min(1, v)); this.drawKnob(); this.onHeadset?.(this.headset); };
    knob.addEventListener('pointerdown', e => { dragY = e.clientY; (knob as Element).setPointerCapture(e.pointerId); });
    knob.addEventListener('pointermove', e => { if (dragY !== null) { setLevel(this.headset + (dragY - e.clientY) / 120); dragY = e.clientY; } });
    knob.addEventListener('pointerup', () => { dragY = null; });
    knob.addEventListener('wheel', e => { e.preventDefault(); setLevel(this.headset - Math.sign(e.deltaY) * 0.05); }, { passive: false });
    // WBS badge (bottom right, as on the drawings)
    root.append(svg('rect', { x: 140, y: 133, width: 26, height: 9, rx: 2.5, fill: 'none', stroke: '#1d1b18', 'stroke-width': 1.2 }),
      svg('text', { x: 153, y: 140.2, class: 'tu-badge', 'text-anchor': 'middle' }, 'WBS'),
      svg('text', { x: 153, y: 148, class: 'tu-lbl', 'text-anchor': 'middle' }, 'WARD-BECK'),
      svg('text', { x: 153, y: 152.6, class: 'tu-lbl', 'text-anchor': 'middle' }, 'SYSTEMS LTD.'));
    this.svgEl = root;
    this.root.replaceChildren(root, el('p', { class: 'muted small' },
      'Talent turret: the mic is a listen-only source. Hold COUGH (or Space) to mute it; MIC OFF mutes until MIC ON.'));
    this.drawKnob();
    this.updateLive();
  }

  private drawKnob() {
    if (!this.knobPtr) return;
    const a = (-135 + this.headset * 270) * Math.PI / 180;
    const kx = 152, ky = 104;
    this.knobPtr.setAttribute('x2', String(kx + Math.sin(a) * 7));
    this.knobPtr.setAttribute('y2', String(ky - Math.cos(a) * 7));
  }

  /** Lamps and VU from live state: talent flags, routes into/out of this position, mic level. */
  updateLive() {
    if (!this.svgEl || !this.gid) return;
    const g = this.gid;
    const t = this.store.talentOf(g);
    const into = this.store.byDst.get(g) ?? [];
    const interrupted = into.some(r => TALK_KINDS.has(r.kind) && r.gain > 0);
    const program = into.some(r => r.kind === 'pgm' && r.gain > 0);
    const micLive = t.mic && !t.cough;
    this.lamps.IFB?.classList.toggle('on', interrupted);
    this.lamps.PGM?.classList.toggle('on', program);
    this.lamps.MIC?.classList.toggle('on', micLive);
    this.lamps.COUGH?.classList.toggle('on', t.cough);
    this.micLed?.classList.toggle('on', t.mic);
    this.svgEl.classList.toggle('coughing', t.cough);
    const lit = vuSegments(this.store.levels.get(g) ?? 0);
    this.seg.forEach((s, i) => s.classList.toggle('on', i < lit));
  }
}
