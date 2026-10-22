// Event log: newest at top, filter by kind and facility.
import { el, fmtF, fmtTime } from './dom';
import type { Store } from './store';
import type { LogEvent } from './types';

const SHOW_MAX = 400;

export function filterEvents(events: LogEvent[], kind: string, facility: number, max = SHOW_MAX): LogEvent[] {
  const out: LogEvent[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < max; i--) {
    const e = events[i];
    if (kind && e.kind !== kind) continue;
    if (facility >= 0 && e.facility !== facility) continue;
    out.push(e);
  }
  return out;
}

export class LogView {
  readonly root: HTMLElement;
  private kindSel: HTMLSelectElement;
  private facSel: HTMLSelectElement;
  private list: HTMLElement;
  private kinds = new Set<string>();

  constructor(private store: Store) {
    this.kindSel = el('select', { class: 'inp', 'aria-label': 'Filter by kind' }, el('option', { value: '' }, 'all kinds'));
    this.facSel = el('select', { class: 'inp', 'aria-label': 'Filter by facility' }, el('option', { value: '-1' }, 'all facilities'));
    this.kindSel.addEventListener('change', () => this.render());
    this.facSel.addEventListener('change', () => this.render());
    this.list = el('div', { class: 'log-list scroll', role: 'log' });
    this.root = el('div', { class: 'log' }, el('div', { class: 'row gap' }, this.kindSel, this.facSel), this.list);
  }

  /** Rebuild selectors + list (snapshot). */
  reset() {
    const n = this.store.facilityCount;
    if (this.facSel.options.length !== n + 1) {
      this.facSel.replaceChildren(el('option', { value: '-1' }, 'all facilities'),
        ...Array.from({ length: n }, (_, f) => el('option', { value: f }, fmtF(f))));
    }
    for (const e of this.store.events) this.addKind(e.kind);
    this.render();
  }

  private addKind(k: string) {
    if (this.kinds.has(k)) return;
    this.kinds.add(k);
    const opts = [...this.kinds].sort();
    const cur = this.kindSel.value;
    this.kindSel.replaceChildren(el('option', { value: '' }, 'all kinds'), ...opts.map(o => el('option', { value: o }, o)));
    this.kindSel.value = cur;
  }

  private row(e: LogEvent): HTMLElement {
    return el('div', { class: `log-row k-${e.kind}` },
      el('span', { class: 'ts mono' }, fmtTime(e.t)),
      el('span', { class: 'lk' }, e.kind),
      el('span', { class: 'lf mono' }, e.facility === null || e.facility === undefined ? '' : fmtF(e.facility)),
      el('span', { class: 'lt' }, e.text));
  }

  render() {
    const evs = filterEvents(this.store.events, this.kindSel.value, Number(this.facSel.value));
    this.list.replaceChildren(...evs.map(e => this.row(e)));
  }

  add(e: LogEvent) {
    this.addKind(e.kind);
    const k = this.kindSel.value, f = Number(this.facSel.value);
    if ((k && e.kind !== k) || (f >= 0 && e.facility !== f)) return;
    this.list.prepend(this.row(e));
    while (this.list.childElementCount > SHOW_MAX) this.list.lastElementChild!.remove();
  }
}
