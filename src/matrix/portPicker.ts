// Searchable picker over all 2048 ports (label, mnemonic, overlay or gid).
import { el } from './dom';
import type { Store } from './store';

export class PortPicker {
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
  private list: HTMLElement;
  private items: number[] = [];
  private cursor = 0;

  constructor(private store: Store, private onPick: (gid: number) => void, placeholder = 'Find port…') {
    this.input = el('input', { type: 'search', class: 'inp', placeholder, autocomplete: 'off', spellcheck: 'false',
      'aria-label': placeholder });
    this.list = el('div', { class: 'picker-list', role: 'listbox', hidden: '' });
    this.root = el('div', { class: 'picker' }, this.input, this.list);
    this.input.addEventListener('input', () => this.refresh());
    this.input.addEventListener('focus', () => this.refresh());
    this.input.addEventListener('blur', () => setTimeout(() => { this.list.hidden = true; }, 150));
    this.input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { this.move(1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { this.move(-1); e.preventDefault(); }
      else if (e.key === 'Enter') { const g = this.items[this.cursor]; if (g) this.pick(g); e.preventDefault(); }
      else if (e.key === 'Escape') { this.list.hidden = true; }
    });
  }

  private move(d: number) {
    if (!this.items.length) return;
    this.cursor = (this.cursor + d + this.items.length) % this.items.length;
    this.paint();
    this.list.children[this.cursor]?.scrollIntoView({ block: 'nearest' });
  }

  private refresh() {
    this.items = this.store.searchPorts(this.input.value, 60).map(p => p.gid);
    this.cursor = 0;
    this.paint();
    this.list.hidden = this.items.length === 0;
  }

  private paint() {
    this.list.replaceChildren(...this.items.map((g, i) => {
      const p = this.store.port(g)!;
      const row = el('div', { class: `picker-item${i === this.cursor ? ' cur' : ''}`, role: 'option' },
        el('span', { class: 'mono' }, p.label), ' ',
        el('b', {}, p.mnemonic), ' ',
        el('span', { class: 'muted' }, `${p.kind} #${g}`));
      row.addEventListener('mousedown', e => { e.preventDefault(); this.pick(g); });
      return row;
    }));
  }

  private pick(gid: number) {
    this.list.hidden = true;
    this.input.value = '';
    this.onPick(gid);
  }
}
