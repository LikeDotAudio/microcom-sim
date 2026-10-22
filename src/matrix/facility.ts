// Facility panel: relays, external triggers, IFB table, EPC list, serial link status + fault injection.
import { el, fmtF, fmtTime } from './dom';
import type { Store } from './store';
import type { EpcEntry } from './types';
import type { MatrixClient } from './ws';

const isBus = (b: number) => !!b && b !== 0xff;

export function epcTypeName(e: EpcEntry): string {
  const t = e.type;
  if (t === 0x40) return 'PERM';
  if (t === 0x41) return 'INHIBIT';
  if (t === 0x42) return `XT${String(e.ext).padStart(2, '0')}`;
  if ((t & 0x06) === 0x04) {
    const mode = (t & 0x40 ? 'T' : '') + (t & 0x80 ? 'L' : '') + (t & 0x20 ? 'M' : '');
    return `EV${String(e.ext).padStart(2, '0')} ${mode}`;
  }
  return `type ${t.toString(16).toUpperCase().padStart(2, '0')}`;
}

export type IfbState = 'normal' | 'interrupted' | 'off';

/** Live IFB state from the program-feed route (gain 1 = normal, dimmed = interrupted). */
export function ifbState(store: Store, pgmGid: number, busGid: number): IfbState {
  const r = store.route(pgmGid, busGid);
  if (!r || r.kind !== 'pgm') return 'off';
  return r.gain >= 1 ? 'normal' : 'interrupted';
}

export class FacilityView {
  readonly root: HTMLElement;
  private title: HTMLElement;
  private relays: HTMLElement;
  private xts: HTMLElement;
  private ifb: HTMLElement;
  private epc: HTMLElement;
  private link: HTMLElement;
  private faultOffline: HTMLInputElement;
  private faultBusy: HTMLInputElement;
  private faultNak: HTMLInputElement;
  facility = 0;

  constructor(private store: Store, private client: MatrixClient) {
    this.title = el('div', { class: 'fac-title' });
    this.relays = el('div', { class: 'relays' });
    this.xts = el('div', { class: 'xts' });
    this.ifb = el('div', { class: 'scroll short' });
    this.epc = el('div', { class: 'scroll short' });
    this.link = el('div', { class: 'link-status' });
    this.faultOffline = el('input', { type: 'checkbox' });
    this.faultBusy = el('input', { type: 'checkbox' });
    this.faultNak = el('input', { type: 'number', min: '0', max: '99', class: 'inp num', value: '0', 'aria-label': 'NAK every n blocks' });
    const sendFaults = () => this.client.send({ t: 'fault', facility: this.facility, faults: {
      offline: this.faultOffline.checked, busy: this.faultBusy.checked,
      nak_every: Math.max(0, Math.min(99, Number(this.faultNak.value) || 0)) } });
    this.faultOffline.addEventListener('change', sendFaults);
    this.faultBusy.addEventListener('change', sendFaults);
    this.faultNak.addEventListener('change', sendFaults);
    this.xts.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b?.dataset.n) return;
      const n = Number(b.dataset.n);
      this.client.send({ t: 'xt', facility: this.facility, n, on: !this.store.xtOn(this.facility, n) });
    });
    const sub = (t: string, ...c: HTMLElement[]) => el('div', { class: 'fac-sec' }, el('h3', {}, t), ...c);
    this.root = el('div', { class: 'facility' },
      this.title,
      el('div', { class: 'fac-grid' },
        sub('Relays', this.relays),
        sub('Serial link', this.link,
          el('div', { class: 'row gap faults' },
            el('label', { class: 'chk' }, this.faultOffline, 'offline'),
            el('label', { class: 'chk' }, this.faultBusy, 'busy (DC1)'),
            el('label', { class: 'chk' }, 'NAK every', this.faultNak)))),
      sub('External triggers', this.xts),
      sub('IFB', this.ifb),
      sub('EPC', this.epc));
  }

  setFacility(f: number) {
    this.facility = f;
    this.render();
  }

  render() {
    const s = this.store, f = this.facility;
    const cfg = s.facilities[f];
    this.title.replaceChildren(el('b', {}, fmtF(f)),
      el('span', { class: 'muted' }, cfg ? ` ${cfg.configured ? 'configured' : 'unconfigured'} · size ${cfg.size} · IFB mode ${cfg.ifbMode} · PGM limit ${cfg.pgmLimit}` : ''));
    this.renderLive();
    this.renderLink();
  }

  /** Parts that change with every routes broadcast. */
  renderLive() {
    const s = this.store, f = this.facility;
    const cfg = s.facilities[f];
    if (!cfg) return;
    this.relays.replaceChildren(...Array.from({ length: 12 }, (_, i) => {
      const out = cfg.relayOut[i];
      const closed = s.relayClosed(f, i + 1);
      const cls = !isBus(out) ? 'relay unused' : closed ? 'relay closed' : 'relay';
      return el('div', { class: cls, title: isBus(out) ? `relay ${i + 1} follows talk into ${s.portName(s.gid(f, out))}` : 'not assigned' },
        el('i', { class: 'lamp' }), el('span', {}, `R${i + 1}`),
        el('span', { class: 'muted small' }, isBus(out) ? s.port(s.gid(f, out))?.mnemonic || String(out) : '—'));
    }));
    this.xts.replaceChildren(...Array.from({ length: 24 }, (_, i) => {
      const n = i + 1;
      const used = cfg.epc.some(e => e.type === 0x42 && e.ext === n);
      return el('button', { type: 'button', class: `xt${s.xtOn(f, n) ? ' on' : ''}${used ? ' used' : ''}`,
        'data-n': n, 'aria-pressed': String(s.xtOn(f, n)), title: used ? 'used by EPC' : 'not used by EPC' },
        `XT${String(n).padStart(2, '0')}`);
    }));
    const ifbRows: HTMLElement[] = [];
    for (let i = 0; i < 48; i++) {
      const bus = cfg.ifbBus[i], pgm = cfg.ifbPgm[i];
      if (!isBus(bus) && !isBus(pgm)) continue;
      const bg = s.gid(f, bus), pg = s.gid(f, pgm);
      const st = isBus(bus) && isBus(pgm) ? ifbState(s, pg, bg) : 'off';
      ifbRows.push(el('tr', {},
        el('td', { class: 'mono' }, `IFB${String(i + 1).padStart(2, '0')}`),
        el('td', {}, isBus(bus) ? s.portName(bg) : '—'),
        el('td', {}, isBus(pgm) ? s.portName(pg) : '—'),
        el('td', {}, el('span', { class: `state ${st}` }, st))));
    }
    this.ifb.replaceChildren(ifbRows.length
      ? el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, ...['IFB', 'Bus', 'Program', 'Live'].map(h => el('th', {}, h)))),
        el('tbody', {}, ...ifbRows))
      : el('div', { class: 'muted' }, 'No IFBs programmed.'));
    const epcRows = cfg.epc.map(e => {
      const src = s.gid(f, e.in), dst = s.gid(f, e.out);
      const r = s.route(src, dst) ?? s.route(dst, src);
      const live = e.type === 0x41 ? !s.route(src, dst) : !!r && r.via.includes('EPC');
      return el('tr', {},
        el('td', {}, s.portName(src)), el('td', {}, '→'), el('td', {}, s.portName(dst)),
        el('td', { class: 'mono' }, epcTypeName(e)),
        el('td', {}, el('i', { class: `lamp${live ? ' on' : ''}` })),
        el('td', { class: 'muted' }, e.comment));
    });
    this.epc.replaceChildren(epcRows.length
      ? el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, ...['In', '', 'Out', 'Type', 'Live', 'Comment'].map(h => el('th', {}, h)))),
        el('tbody', {}, ...epcRows))
      : el('div', { class: 'muted' }, 'No EPC entries.'));
  }

  renderLink() {
    const l = this.store.links.get(this.facility);
    if (!l) { this.link.replaceChildren(el('span', { class: 'muted' }, 'no link')); return; }
    this.link.replaceChildren(
      el('span', { class: `lamp${l.connected ? ' on' : ''}` }),
      el('span', {}, l.connected ? 'MCOM connected' : 'waiting for MCOM'),
      el('span', { class: 'muted' }, ` tcp ${l.port} · ${l.blocks} blocks${l.lastRx ? ` · last ${fmtTime(l.lastRx)}` : ''}`));
    if (document.activeElement !== this.faultNak) this.faultNak.value = String(l.faults.nak_every ?? 0);
    this.faultOffline.checked = !!l.faults.offline;
    this.faultBusy.checked = !!l.faults.busy;
  }
}
