// The key strip: one station's keys in a single row, small enough for a taskbar (the APK.audio OS footer
// frames it). Same engine, same client and same keys as the full panel page: click latches, hold is
// momentary, the lamps follow the engine's `active` set, and a key whose target is talking to you glows
// amber. 🎧 joins the intercom audio; ⤢ asks whoever frames the strip to open the full panel.
//
//   strip.html?p=PROD01/PNL02&keys=12     the station and how many keys (default: the one remembered, 12)
//
// Framed, it tells its parent what it needs: { source: 'microcom-strip', width, station, calling, open? };
// a frame that has less room says so, { source: 'apkos-footer', room }, and the strip shows fewer keys
// rather than being cut off at the end, where 🎧 and ⤢ are.
import './style.css';
import { el } from '../matrix/dom';
import { HOLD_MS } from '../matrix/keypanel';
import { Store } from '../matrix/store';
import { TALK_KINDS } from '../matrix/types';
import { MatrixClient } from '../matrix/ws';
import { panelHref, resolveEngine } from '../local/mode';
import { Voice } from '../panel/voice';
import { chooseStation, DEFAULT_KEYS, keysThatFit, panelPorts, STATION_KEY, stationName, stripKeys, type StripKey } from './model';

const params = new URLSearchParams(location.search);
const maxKeys = Math.max(1, Math.min(64, Number(params.get('keys')) || DEFAULT_KEYS));

const store = new Store();
const client = new MatrixClient(store);
const voice = new Voice(store, client);
const app = document.getElementById('app')!;

let gid: number | null = null;
let room: number | null = null;
let keys: StripKey[] = [];
const keyEls = new Map<number, HTMLButtonElement>();
const held = new Set<number>();

const remembered = () => { try { return localStorage.getItem(STATION_KEY); } catch { return null; } };
const remember = (label: string) => { try { localStorage.setItem(STATION_KEY, label); } catch { /* private window */ } };

const picker = el('select', { class: 'st-pick', title: 'Your station — the panel these keys are on' }) as HTMLSelectElement;
picker.addEventListener('change', () => {
  const g = Number(picker.value);
  const p = store.port(g);
  if (!p) return;
  remember(p.label);
  setStation(g);
});
const row = el('div', { class: 'st-keys' });
const audio = el('button', { type: 'button', class: 'st-btn', title: 'Join the intercom audio: your microphone into this station, what the matrix routes to it out of your speakers' }, '🎧') as HTMLButtonElement;
audio.addEventListener('click', () => (voice.state === 'on' ? voice.leave() : gid !== null && void voice.join(gid)));
const open = el('button', { type: 'button', class: 'st-btn', title: 'Open the full panel' }, '⤢') as HTMLButtonElement;
open.addEventListener('click', () => {
  const p = gid !== null ? store.port(gid) : null;
  if (!p) return;
  // framed: the frame decides where the panel opens; on its own, the panel page is next door
  if (window.parent !== window) tell({ open: 'panel', p: p.label.replace(' ', '/') });
  else location.href = panelHref(p.label);
});
const conn = el('span', { class: 'st-conn off', title: 'connecting to the matrix…' });
app.replaceChildren(el('div', { class: 'strip' }, conn, picker, row, audio, open));

function tell(extra: Record<string, unknown> = {}) {
  if (window.parent === window) return;
  const p = gid !== null ? store.port(gid) : null;
  const calling = keys.filter(k => isCalling(k)).length;
  window.parent.postMessage({ source: 'microcom-strip', width: Math.ceil(app.scrollWidth), station: p?.label ?? null, calling, ...extra }, '*');
}

function fillPicker() {
  const panels = panelPorts(store.ports.filter(Boolean));
  picker.replaceChildren(...panels.map(p => el('option', { value: p.gid }, stationName(p))));
  if (gid !== null) picker.value = String(gid);
}

function setStation(g: number) {
  if (voice.state === 'on' && voice.gid !== g) voice.leave();
  gid = g;
  picker.value = String(g);
  row.replaceChildren(el('span', { class: 'st-wait' }, '…'));
  client.requestStation(g);
}

function renderKeys() {
  const st = store.station;
  if (!st || st.gid !== gid) return;
  // everything but the keys: the strip's own width less the key row's
  const chrome = Math.ceil(app.scrollWidth - row.scrollWidth) + 8;
  keys = stripKeys(st, keysThatFit(room, chrome, maxKeys), x => store.portName(x));
  keyEls.clear();
  row.replaceChildren(...keys.map(k => {
    const b = el('button', { type: 'button', class: 'st-key', title: k.title }, el('span', { class: 'led' }), el('span', { class: 'lg' }, k.legend)) as HTMLButtonElement;
    bindKey(b, k.slot);
    keyEls.set(k.slot, b);
    return b;
  }));
  if (!keys.length) row.replaceChildren(el('span', { class: 'st-wait' }, 'no keys'));
  updateLamps();
}

/** Click latches; held past HOLD_MS it is momentary, released when let go (as on the panel page). */
function bindKey(b: HTMLButtonElement, slot: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pressed = false;
  let down = false;
  b.addEventListener('pointerdown', ev => {
    if (ev.button !== 0 || gid === null) return;
    ev.preventDefault();
    b.setPointerCapture(ev.pointerId);
    down = true;
    pressed = false;
    const g = gid;
    timer = setTimeout(() => {
      pressed = true;
      held.add(slot);
      client.key(g, slot, 'press');
      updateLamps();
    }, HOLD_MS);
  });
  const end = (cancel: boolean) => {
    if (!down || gid === null) return;
    down = false;
    if (timer) clearTimeout(timer);
    timer = null;
    if (pressed) {
      held.delete(slot);
      client.key(gid, slot, 'release');
    } else if (!cancel) client.key(gid, slot, 'toggle');
    pressed = false;
    updateLamps();
  };
  b.addEventListener('pointerup', () => end(false));
  b.addEventListener('pointercancel', () => end(true));
}

function isCalling(k: StripKey): boolean {
  if (gid === null || k.target === null) return false;
  const r = store.route(k.target, gid);
  return !!r && r.gain > 0 && TALK_KINDS.has(r.kind);
}

function updateLamps() {
  if (gid === null) return;
  for (const k of keys) {
    const b = keyEls.get(k.slot);
    if (!b) continue;
    const on = held.has(k.slot) ? 'press' : store.isActive(gid, k.slot);
    b.classList.toggle('latch', on === 'latch');
    b.classList.toggle('press', on === 'press');
    b.classList.toggle('calling', isCalling(k));
  }
  tell();
}

function renderAudio() {
  audio.classList.toggle('on', voice.state === 'on');
  audio.classList.toggle('muted', voice.state === 'on' && voice.muted);
  audio.title = voice.state === 'on' ? 'Intercom audio is on — click to leave' : voice.state === 'error' ? voice.error : 'Join the intercom audio';
}
voice.onChange = renderAudio;

store.subscribe(topic => {
  switch (topic) {
    case 'snapshot': {
      fillPicker();
      if (gid === null) {
        const p = chooseStation(store.ports.filter(Boolean), params.get('p'), remembered());
        if (p) setStation(p.gid);
        else row.replaceChildren(el('span', { class: 'st-wait' }, 'no panels'));
      } else client.requestStation(gid);
      break;
    }
    case 'station': renderKeys(); break;
    case 'routes': updateLamps(); break;
    case 'conn':
      conn.className = `st-conn ${store.connected ? 'on' : 'off'}`;
      conn.title = store.connected ? 'live' : 'reconnecting…';
      break;
  }
});
addEventListener('resize', () => tell());
addEventListener('message', ev => {
  if (ev.source !== window.parent || ev.data?.source !== 'apkos-footer' || !Number.isFinite(ev.data.room)) return;
  if (room === ev.data.room) return;
  room = ev.data.room;
  renderKeys();
});
void resolveEngine().then(() => client.connect());
