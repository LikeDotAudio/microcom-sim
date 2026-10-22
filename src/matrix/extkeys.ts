// Extended (matrix-level, cross-facility) keys editor for the selected station.
import { button, el } from './dom';
import { PortPicker } from './portPicker';
import type { Store } from './store';
import type { ExtKey } from './types';
import type { MatrixClient } from './ws';

export class ExtKeysView {
  readonly root: HTMLElement;
  private list: HTMLElement;
  private status: HTMLElement;
  private draft: ExtKey[] = [];
  private gid: number | null = null;
  private dirty = false;

  constructor(private store: Store, private client: MatrixClient) {
    this.list = el('div', { class: 'ek-list' });
    this.status = el('span', { class: 'muted small' });
    const bar = el('div', { class: 'row gap' },
      button('+ Key', () => {
        this.draft.push({ label: `X${this.draft.length + 1}`, targets: [], talk: true, listen: false });
        this.markDirty(); this.render();
      }, { class: 'btn sm' }),
      button('Save', () => this.save(), { class: 'btn sm primary' }),
      button('Revert', () => { this.dirty = false; this.load(); }, { class: 'btn sm' }),
      this.status);
    this.root = el('div', { class: 'extkeys' }, bar, this.list);
  }

  setStation(gid: number | null) {
    if (gid === this.gid) return;
    this.gid = gid;
    this.dirty = false;
    this.load();
  }

  /** Called on snapshot: refresh from the server unless the user is editing. */
  refresh() { if (!this.dirty) this.load(); }

  private load() {
    const keys = this.gid ? this.store.extKeys.get(this.gid) ?? [] : [];
    this.draft = keys.map(k => ({ label: k.label, targets: [...k.targets], talk: k.talk !== false, listen: !!k.listen }));
    this.render();
  }

  private markDirty() {
    this.dirty = true;
    this.status.textContent = 'unsaved changes';
  }

  private save() {
    if (!this.gid) return;
    const keys = this.draft.filter(k => k.targets.length).map(k => ({ ...k, label: k.label.trim().slice(0, 8) || 'EXT' }));
    if (this.client.send({ t: 'extkeys', gid: this.gid, keys })) {
      this.dirty = false;
      this.status.textContent = `saved ${keys.length} key(s)`;
    } else {
      this.status.textContent = 'not connected';
    }
  }

  private render() {
    if (!this.gid) {
      this.status.textContent = '';
      this.list.replaceChildren(el('div', { class: 'muted' }, 'Select a station to edit its extended keys.'));
      return;
    }
    if (!this.dirty) this.status.textContent = `${this.draft.length} key(s) on ${this.store.portName(this.gid)}`;
    this.list.replaceChildren(...this.draft.map((k, i) => this.row(k, i)));
    if (!this.draft.length) this.list.append(el('div', { class: 'muted small' }, 'No extended keys. Extended keys can reach any of the 2048 ports.'));
  }

  private row(k: ExtKey, i: number): HTMLElement {
    const lbl = el('input', { class: 'inp lbl', value: k.label, maxlength: '8', 'aria-label': 'Key label' });
    lbl.addEventListener('input', () => { k.label = lbl.value; this.markDirty(); });
    const chk = (name: string, on: boolean, set: (v: boolean) => void) => {
      const c = el('input', { type: 'checkbox', checked: on });
      c.addEventListener('change', () => { set(c.checked); this.markDirty(); });
      return el('label', { class: 'chk' }, c, name);
    };
    const chips = el('div', { class: 'chips' }, ...k.targets.map((t, j) => {
      const c = el('span', { class: 'chip rm', title: 'remove' }, this.store.portName(t), ' ×');
      c.addEventListener('click', () => { k.targets.splice(j, 1); this.markDirty(); this.render(); });
      return c;
    }));
    const picker = new PortPicker(this.store, g => {
      if (!k.targets.includes(g) && g !== this.gid) k.targets.push(g);
      this.markDirty(); this.render();
    }, 'add target…');
    return el('div', { class: 'ek-row' },
      el('div', { class: 'row gap' },
        el('span', { class: 'k-lbl' }, `X${i + 1}`), lbl,
        chk('talk', k.talk, v => { k.talk = v; }), chk('listen', k.listen, v => { k.listen = v; }),
        button('Remove', () => { this.draft.splice(i, 1); this.markDirty(); this.render(); }, { class: 'btn sm danger' })),
      chips, picker.root);
  }
}
