// "Monitor" panel: hear a destination port's output (mix of its routes), per-port input sources, meter.
import { AudioEngine } from './audio';
import { computeMix, SOURCE_KINDS, toDb, type MixEntry, type SourceKind } from './audioMix';
import { button, el } from './dom';
import { PortPicker } from './portPicker';
import type { Store } from './store';

export class MonitorView {
  readonly root: HTMLElement;
  readonly engine = new AudioEngine();
  private enableBtn: HTMLButtonElement;
  private target: HTMLElement;
  private follow: HTMLInputElement;
  private table: HTMLElement;
  private meterBar: HTMLElement;
  private meterPeak: HTMLElement;
  private meterTxt: HTMLElement;
  private muteBtn: HTMLButtonElement;
  private msg: HTMLElement;
  private dst: number | null = null;
  private selected: number | null = null;
  private mixSig = '';
  private peakHold = 0;

  constructor(private store: Store) {
    this.enableBtn = button('Enable audio', () => this.enable(), { class: 'btn primary' });
    this.target = el('span', { class: 'mono b' }, '—');
    this.follow = el('input', { type: 'checkbox', checked: true });
    this.follow.addEventListener('change', () => { if (this.follow.checked) this.setDst(this.selected); });
    const picker = new PortPicker(store, g => { this.follow.checked = false; this.setDst(g); }, 'Monitor another port…');
    const vol = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(this.engine.volume), 'aria-label': 'Master volume' });
    vol.addEventListener('input', () => this.engine.setVolume(Number(vol.value)));
    this.muteBtn = button('Mute', () => {
      this.engine.setMuted(!this.engine.muted);
      this.muteBtn.classList.toggle('on', this.engine.muted);
      this.muteBtn.textContent = this.engine.muted ? 'Muted' : 'Mute';
    }, { class: 'btn sm' });
    const def = el('select', { class: 'inp', 'aria-label': 'Default input source' },
      ...(['tone', 'speech', 'noise', 'off'] as SourceKind[]).map(k => el('option', { value: k }, k)));
    def.addEventListener('change', () => { this.engine.setDefaultKind(def.value as SourceKind); this.update(true); });
    this.meterBar = el('div', { class: 'meter-bar' });
    this.meterPeak = el('div', { class: 'meter-peak' });
    this.meterTxt = el('span', { class: 'mono small meter-txt' }, '-∞ dB');
    this.table = el('div', { class: 'mon-sources scroll short' });
    this.msg = el('div', { class: 'muted small' });
    const micPicker = new PortPicker(store, g => { void this.assign(g, 'mic'); }, 'Assign microphone to port…');
    this.root = el('div', { class: 'monitor' },
      el('div', { class: 'row gap wrap' }, this.enableBtn, el('span', {}, 'Monitoring '), this.target,
        el('label', { class: 'chk' }, this.follow, 'follow selection')),
      picker.root,
      el('div', { class: 'row gap wrap' }, el('span', { class: 'small' }, 'Vol'), vol, this.muteBtn,
        el('span', { class: 'small' }, 'Default input'), def),
      el('div', { class: 'meter' }, this.meterBar, this.meterPeak), this.meterTxt,
      el('div', { class: 'small muted' }, 'Inputs feeding this output (each × route gain):'),
      this.table, micPicker.root, this.msg);
    this.renderTable([]);
  }

  private async enable() {
    try {
      await this.engine.enable();
      this.engine.slice = this.store.slice;
      this.enableBtn.textContent = 'Audio on';
      this.enableBtn.disabled = true;
      this.update(true);
      const tick = () => { this.meter(); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    } catch (e) {
      this.msg.textContent = `audio failed: ${(e as Error).message}`;
    }
  }

  setSelected(gid: number | null) {
    this.selected = gid;
    if (this.follow.checked) this.setDst(gid);
  }

  private setDst(gid: number | null) {
    this.dst = gid;
    this.target.textContent = gid ? this.store.portName(gid) : '—';
    this.update(true);
  }

  /** Recompute the mix (after routes or source changes) and push it to the audio graph. */
  update(force = false) {
    const mix: MixEntry[] = this.dst
      ? computeMix(this.store.byDst.get(this.dst), this.dst, g => this.engine.sourceKind(g)) : [];
    this.engine.setMix(mix);
    const all = this.dst ? computeMix(this.store.byDst.get(this.dst), this.dst) : [];
    const sig = all.map(e => `${e.src}:${e.gain}:${e.kind}:${this.engine.sourceKind(e.src)}`).join(',');
    if (force || sig !== this.mixSig) { this.mixSig = sig; this.renderTable(all); }
  }

  private async assign(gid: number, kind: SourceKind | 'default') {
    try {
      await this.engine.setSource(gid, kind);
      this.msg.textContent = kind === 'mic' ? `microphone → ${this.store.portName(gid)}` : '';
    } catch (e) {
      this.msg.textContent = `microphone unavailable: ${(e as Error).message}`;
    }
    this.update(true);
  }

  private renderTable(mix: MixEntry[]) {
    if (!this.dst) { this.table.replaceChildren(el('div', { class: 'muted small' }, 'Select a port to monitor.')); return; }
    if (!mix.length) { this.table.replaceChildren(el('div', { class: 'muted small' }, 'Nothing routed to this output (silence).')); return; }
    const rows = mix.map(e => {
      const kind = this.engine.sourceKind(e.src);
      const sel = el('select', { class: 'inp sm', 'aria-label': `Source of ${this.store.label(e.src)}` },
        el('option', { value: 'default' }, `default (${this.engine.defaultKind})`),
        ...SOURCE_KINDS.map(k => el('option', { value: k }, k)));
      sel.value = this.engine.hasOverride(e.src) ? kind : 'default';
      const file = el('input', { type: 'file', accept: 'audio/*', class: 'file', hidden: kind !== 'file' && sel.value !== 'file' });
      sel.addEventListener('change', () => {
        if (sel.value === 'file') { file.hidden = false; if (!this.engine.fileName(e.src)) { file.click(); return; } }
        void this.assign(e.src, sel.value as SourceKind | 'default');
      });
      file.addEventListener('change', async () => {
        const f = file.files?.[0];
        if (!f) return;
        try { await this.engine.loadFile(e.src, f); this.msg.textContent = `${f.name} → ${this.store.portName(e.src)}`; }
        catch (err) { this.msg.textContent = `cannot decode ${f.name}: ${(err as Error).message}`; }
        this.update(true);
      });
      return el('tr', {},
        el('td', {}, this.store.portName(e.src)),
        el('td', {}, el('i', { class: 'sw', style: `background:var(--rk-${e.kind})` }), ` ${e.kind}`),
        el('td', { class: 'num' }, e.gain.toFixed(2)),
        el('td', {}, sel, file, this.engine.fileName(e.src) && kind === 'file'
          ? el('span', { class: 'muted small' }, ` ${this.engine.fileName(e.src)}`) : null));
    });
    this.table.replaceChildren(el('table', { class: 'tbl' },
      el('thead', {}, el('tr', {}, ...['Input', 'Route', 'Gain', 'Source'].map(h => el('th', {}, h)))),
      el('tbody', {}, ...rows)));
  }

  private meter() {
    const { peak, rms } = this.engine.level();
    this.peakHold = Math.max(peak, this.peakHold * 0.97);
    const pos = (v: number) => `${Math.max(0, Math.min(100, (toDb(v, -60) + 60) / 60 * 100))}%`;
    this.meterBar.parentElement!.style.setProperty('--fill', pos(rms * Math.SQRT2));
    this.meterPeak.style.left = pos(this.peakHold);
    this.meterTxt.textContent = `peak ${toDb(this.peakHold, -90).toFixed(1)} dBFS · rms ${toDb(rms, -90).toFixed(1)} dBFS`;
  }
}
