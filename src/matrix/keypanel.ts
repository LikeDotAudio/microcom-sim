// Emulated keypanel of the selected station. Click = toggle latch; hold > 300 ms = momentary.
import { el, fmtF } from './dom';
import type { Store } from './store';
import type { StationKey } from './types';
import { isM2026, PANEL_MODEL_NAMES, PANEL_MODELS, renderPanel, unitModels } from './panelSvg';
import type { MatrixClient } from './ws';
import { M2026View } from '../m2026/view';

export const HOLD_MS = 300;

/** Keyboard key -> physical key label ('1'..'9', '0' = key 10, 'a'..'d' = A..D). */
export function labelForKeyboard(k: string): string | null {
  if (/^[1-9]$/.test(k)) return k;
  if (k === '0') return '10';
  if (/^[a-dA-D]$/.test(k)) return k.toUpperCase();
  return null;
}

const PHANTOM_DESC: Record<string, string> = {
  GRP: 'group', CA: 'call', CMA: 'cams', CNF: 'conf', EV: 'event', IS: 'iso',
};

export class KeypanelView {
  readonly root: HTMLElement;
  private head: HTMLElement;
  private body: HTMLElement;
  private keyEls = new Map<number, Element>();
  private held = new Set<number>();
  private sig = '';
  /** end handler of the key currently held down (window-level safety net if the element loses capture) */
  private ending: ((cancel: boolean) => void) | null = null;
  /** MicroCOM 2026 panel (models M2026 / M2026P): screens, map, rich key legends */
  m2026: M2026View | null = null;

  constructor(private store: Store, private client: MatrixClient) {
    this.head = el('div', { class: 'kp-head' }, el('span', { class: 'muted' }, 'No station selected — click a port or crosspoint.'));
    this.body = el('div', { class: 'kp-body' });
    this.root = el('div', { class: 'keypanel', tabindex: '0', 'aria-label': 'Keypanel (keys 1-9, 0, A-D)' }, this.head, this.body);
    window.addEventListener('pointerup', () => this.ending?.(false));
    window.addEventListener('blur', () => this.ending?.(true));
    this.root.addEventListener('keydown', e => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement) !== this.root) return;
      if (this.m2026 && this.m2026.onKey(e)) { e.preventDefault(); return; }
      const lbl = labelForKeyboard(e.key);
      const st = this.store.station;
      if (!lbl || !st) return;
      const k = st.keys.find(x => x.label === lbl && x.slot < 100);
      if (k && k.kind !== 'empty') { this.client.key(st.gid, k.slot, 'toggle'); e.preventDefault(); }
    });
  }

  /** Rebuild the panel only when the station's layout/programming changed (lamps update in place). */
  render() {
    const st = this.store.station;
    const sig = st ? JSON.stringify({ ...st, keys: st.keys.map(k => ({ ...k, on: null })) }) : '';
    if (sig === this.sig && st) { this.updateLamps(); return; }
    this.sig = sig;
    this.keyEls.clear();
    if (!st || !isM2026(st.panelModel) || this.m2026?.gid !== st.gid
      || this.m2026.producer !== (st.panelModel === 'M2026P')) {
      this.m2026?.dispose();
      this.m2026 = null;
    }
    if (!st) {
      this.head.replaceChildren(el('span', { class: 'muted' }, 'No station selected — click a port or crosspoint.'));
      this.body.replaceChildren();
      return;
    }
    const s = this.store;
    const groups: HTMLElement[] = [];
    for (let g = 0; g < 4; g++) {
      const members = (st.groups ?? []).slice(g * 6, g * 6 + 6).filter(b => b && b !== 255);
      if (members.length) groups.push(el('span', { class: 'grp' }, el('b', {}, `GRP${g + 1}`), ' ',
        members.map(b => s.port(s.gid(st.facility, b))?.mnemonic || b).join(' ')));
    }
    this.head.replaceChildren(
      el('div', { class: 'kp-title' },
        el('span', { class: 'kp-mn' }, st.mnemonic.trim() || '—'),
        el('span', { class: 'mono' }, st.label),
        st.overlay.trim() ? el('span', { class: 'chip' }, `ovl ${st.overlay.trim()}`) : null,
        this.modelPicker(st),
        el('span', { class: 'muted' }, `${fmtF(st.facility)} bus ${st.local} · #${st.gid} · ${st.kind}`)),
      ...(groups.length ? [el('div', { class: 'kp-groups small' }, ...groups)] : []));

    let svg: SVGSVGElement, keys: Map<number, SVGGElement>;
    if (isM2026(st.panelModel)) {
      this.m2026 ??= new M2026View(this.store, this.client, st.gid, st.panelModel!);
      ({ svg, keys } = this.m2026.build(st));
    } else {
      ({ svg, keys } = renderPanel(st, k => this.keyTitle(k)));
    }
    for (const [slot, g] of keys) {
      this.keyEls.set(slot, g);
      const k = st.keys.find(x => x.slot === slot);
      if (k && k.kind !== 'empty') this.bindKey(g, slot);
    }
    this.body.replaceChildren(svg);
    if (!st.keys.length) this.body.append(el('div', { class: 'muted' }, 'This port has no keys.'));
    this.updateLamps();
  }

  /** Panel model chooser: the MCOM terminal type, or a matrix-only 32/64-key station. */
  private modelPicker(st: NonNullable<Store['station']>): HTMLElement {
    const mcom = st.type && st.type !== '0' ? unitModels(st.type, st.typeName)[0] : 'no terminal';
    const sel = el('select', { class: 'inp kp-model', 'aria-label': 'Panel model',
      title: 'Panel model: the MCOM terminal type, or a 32/64-key matrix station (extra keys are matrix keys)' },
      el('option', { value: '' }, `${mcom} (MCOM)`),
      ...Object.entries(PANEL_MODELS).map(([m, n]) => el('option', { value: m }, PANEL_MODEL_NAMES[m] ?? `${m} — ${n} keys`))) as HTMLSelectElement;
    sel.value = st.panelModel ?? '';
    if (!this.store.role.admin) sel.disabled = true;      // panel links cannot change the model (engine refuses too)
    sel.addEventListener('change', () => this.client.panelModel(st.gid, sel.value || null));
    return sel;
  }

  private keyTitle(k: StationKey): string {
    const s = this.store;
    if (k.kind === 'bus') return `${k.label}: ${k.name.trim()} ${k.mode} → ${k.target ? s.portName(k.target) : `bus ${k.bus}`}`;
    if (k.kind === 'phantom') {
      const fam = k.name.replace(/\d+$/, '');
      return `${k.label}: ${k.name} (${PHANTOM_DESC[fam] ?? 'phantom'})`;
    }
    if (k.kind === 'ext') return `${k.label}: extended → ${(k.targets ?? []).map(t => s.portName(t)).join(', ')}`;
    return `${k.label}: unassigned`;
  }

  private bindKey(e: Element, slot: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pressed = false;
    let down = false;
    let downGid = 0;                       // station the press started on
    const gid = () => downGid;
    e.addEventListener('pointerdown', raw => {
      const ev = raw as PointerEvent;
      if (ev.button !== 0) return;
      ev.preventDefault();
      e.setPointerCapture(ev.pointerId);
      this.root.focus({ preventScroll: true });
      down = true; pressed = false;
      downGid = this.store.station?.gid ?? 0;
      this.ending = end;
      e.classList.add('down');
      timer = setTimeout(() => {
        pressed = true;
        this.held.add(slot);
        this.client.key(gid(), slot, 'press');
        this.updateLamps();
      }, HOLD_MS);
    });
    const end = (cancel: boolean) => {
      if (!down) return;
      down = false;
      if (this.ending === end) this.ending = null;
      e.classList.remove('down');
      if (timer) clearTimeout(timer);
      timer = null;
      if (pressed) {
        this.held.delete(slot);
        this.client.key(gid(), slot, 'release');
      } else if (!cancel) {
        this.client.key(gid(), slot, 'toggle');
      }
      pressed = false;
      this.updateLamps();
    };
    e.addEventListener('pointerup', () => end(false));
    e.addEventListener('pointercancel', () => end(true));
  }

  /** Lamps follow the live `active` set of the routes broadcast (authoritative, sent on every change). */
  updateLamps() {
    const st = this.store.station;
    if (!st) return;
    for (const k of st.keys) {
      const e = this.keyEls.get(k.slot);
      if (!e) continue;
      const on = this.store.isActive(st.gid, k.slot);
      const mode = this.held.has(k.slot) ? 'press' : on;
      e.classList.toggle('latch', mode === 'latch');
      e.classList.toggle('press', mode === 'press');
    }
  }
}
