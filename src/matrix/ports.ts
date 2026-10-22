// Ports list: selected facility, or a search across all 2048 ports; live tallies.
import { el, fmtF } from './dom';
import type { Store } from './store';

/** Terminal type -> model name (mirrors config.TERMINALS). */
export const TERMINAL_NAMES: Record<string, string> = {
  '0': '', '1': 'M7880', '2': 'M7880/81', '3': 'M7880B', '4': 'M7880D', '5': 'M7880/F',
  '6': 'M7880D/F', '7': 'M7882/83', '8': 'M7884/85', '9': 'M7840',
};

export class PortsView {
  readonly root: HTMLElement;
  private search: HTMLInputElement;
  private tbody: HTMLTableSectionElement;
  private caption: HTMLElement;
  private rows = new Map<number, { tr: HTMLTableRowElement; tally: HTMLElement }>();
  facility = -1;
  selected: number | null = null;
  onSelect: (gid: number) => void = () => {};

  constructor(private store: Store) {
    this.search = el('input', { type: 'search', class: 'inp', placeholder: 'Search all ports (label, mnemonic, #)…',
      'aria-label': 'Search ports' });
    this.search.addEventListener('input', () => this.render());
    this.caption = el('div', { class: 'muted small' });
    this.tbody = el('tbody');
    const table = el('table', { class: 'tbl ports-tbl' },
      el('thead', {}, el('tr', {}, ...['#', 'Port', 'Mnem', 'Ovl', 'Kind', 'Term', 'Tally'].map(h => el('th', {}, h)))),
      this.tbody);
    this.tbody.addEventListener('click', e => {
      const tr = (e.target as HTMLElement).closest('tr');
      if (tr?.dataset.gid) this.onSelect(Number(tr.dataset.gid));
    });
    this.root = el('div', { class: 'ports-view' }, this.search, this.caption, el('div', { class: 'scroll' }, table));
  }

  setFacility(f: number) { this.facility = f; this.render(); }
  setSelected(gid: number | null) {
    if (this.selected) this.rows.get(this.selected)?.tr.classList.remove('sel');
    this.selected = gid;
    if (gid) {
      if (this.facility < 0 && !this.search.value && !this.rows.has(gid)) { this.render(); return; }
      this.rows.get(gid)?.tr.classList.add('sel');
    }
  }

  render() {
    const s = this.store;
    const q = this.search.value.trim();
    let ports;
    if (q) {
      ports = s.searchPorts(q, 300);
      this.caption.textContent = `${ports.length}${ports.length >= 300 ? '+' : ''} matches across all facilities`;
    } else {
      const f = this.facility >= 0 ? this.facility : this.selected ? s.facilityOf(this.selected) : 0;
      ports = s.facilityPorts(f);
      this.caption.textContent = `${fmtF(f)} — ${ports.length} ports${this.facility < 0 ? ' (facility of selected station)' : ''}`;
    }
    this.rows.clear();
    this.tbody.replaceChildren(...ports.map(p => {
      const tally = el('td', { class: 'tally' });
      const tr = el('tr', { 'data-gid': p.gid, class: p.gid === this.selected ? 'sel' : undefined },
        el('td', { class: 'num' }, p.gid),
        el('td', { class: 'mono' }, p.label),
        el('td', { class: 'mono b' }, p.mnemonic),
        el('td', { class: 'mono' }, p.overlay),
        el('td', {}, p.kind),
        el('td', {}, TERMINAL_NAMES[p.termType] ?? p.termType, p.hasKeys ? el('span', { class: 'kp', title: 'has keys' }, ' ⌨') : ''),
        tally);
      this.rows.set(p.gid, { tr, tally });
      return tr;
    }));
    this.updateTally();
  }

  updateTally() {
    for (const [gid, { tally }] of this.rows) {
      const t = this.store.getTally(gid);
      const key = `${+t.talking}${+t.talkedTo}${+t.listening}`;
      if (tally.dataset.k === key) continue;
      tally.dataset.k = key;
      tally.replaceChildren(
        el('span', { class: `tl t${t.talking ? ' on' : ''}`, title: 'talking' }, 'TK'),
        el('span', { class: `tl r${t.talkedTo ? ' on' : ''}`, title: 'being talked to' }, 'RX'),
        el('span', { class: `tl l${t.listening ? ' on' : ''}`, title: 'listening' }, 'LS'));
    }
  }
}
