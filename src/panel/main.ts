// Standalone station page: one emulated keypanel per URL (/panel/F01/PNL01), plus the /panels index.
import '../matrix/style.css';
import { button, el, fmtF } from '../matrix/dom';
import { KeypanelView } from '../matrix/keypanel';
import { TurretView } from '../matrix/turret';
import { MonitorView } from '../matrix/monitor';
import { Store } from '../matrix/store';
import type { Port } from '../matrix/types';
import { MatrixClient } from '../matrix/ws';
import { resolvePanel } from './route';
import { pageHref, panelHref, panelRoutePath, resolveEngine } from '../local/mode';
import { Voice } from './voice';
import { LISTEN_KINDS, TALK_KINDS } from '../matrix/types';
import { ProximityAgent } from '../m2026/proximity';
import { m2026Env } from '../m2026/view';
import { isM2026 } from '../matrix/panelSvg';

const store = new Store();
const client = new MatrixClient(store);
const app = document.getElementById('app')!;
const connPill = el('span', { class: 'pill off' }, 'connecting…');
let gid: number | null = null;
let keypanel: KeypanelView | null = null;
let turret: TurretView | null = null;
let monitor: MonitorView | null = null;
const voice = new Voice(store, client);
let renderVoice: () => void = () => {};
// MicroCOM 2026: acoustic proximity runs whenever this page has intercom audio on
const prox = new ProximityAgent(store, client, () => (voice.state === 'on' ? voice.gid : null));
prox.onChange = () => renderVoice();
m2026Env.audioOn = g => voice.state === 'on' && voice.gid === g;
const brandMark = el('span', { class: 'brand-mark' }, 'MicroCOM II');

function renderConn() {
  connPill.className = `pill ${store.connected ? 'on' : 'off'}`;
  connPill.textContent = store.connected ? 'live' : 'reconnecting…';
}

const shareUrl = () => (gid && store.panelLinks.get(gid)) || location.href;

async function copyLink(btn: HTMLButtonElement) {
  try {
    await navigator.clipboard.writeText(shareUrl());
    btn.textContent = 'Link copied';
  } catch {
    prompt('Copy this panel link:', shareUrl());
  }
  setTimeout(() => { btn.textContent = 'Copy link'; }, 2000);
}

function mailto(p: Port): string {
  const name = p.mnemonic.trim() || p.label;
  const body = `Your MicroCOM intercom panel: ${name} (${p.label})\n\n${shareUrl()}\n\n` +
    'Open it in Chrome, Edge or Firefox on the same network. The first time, the browser warns about the ' +
    "matrix's self-signed certificate: choose Advanced, then Proceed. Press 'Join intercom audio' and " +
    'allow the microphone; a headset avoids echo.\n';
  return `mailto:?subject=${encodeURIComponent(`Intercom panel ${name}`)}&body=${encodeURIComponent(body)}`;
}

/** Live intercom card: join/leave, mic mute, meters, who this station talks to and hears. */
function voiceCard(g: number): HTMLElement {
  const btn = button('Join intercom audio', () => (voice.state === 'on' ? voice.leave() : void voice.join(g)), { class: 'btn primary' });
  const mute = button('Mute mic', () => voice.setMuted(!voice.muted), { class: 'btn' });
  const micBar = el('i', { class: 'vbar-fill' }), outBar = el('i', { class: 'vbar-fill' });
  const status = el('span', { class: 'small' });
  const talk = el('div', { class: 'small' }), hear = el('div', { class: 'small' });
  const proxLine = el('div', { class: 'small muted prox-line' });
  const names = (gids: number[]) => gids.length ? gids.map(x => store.portName(x)).join(', ') : '—';
  renderVoice = () => {
    btn.textContent = voice.state === 'on' ? 'Leave audio' : voice.state === 'starting' ? 'Starting…' : 'Join intercom audio';
    mute.textContent = voice.muted ? 'Unmute mic' : 'Mute mic';
    mute.toggleAttribute('disabled', voice.state !== 'on');
    const out = store.bySrc.get(g) ?? [], inn = store.byDst.get(g) ?? [];
    const talking = out.filter(r => TALK_KINDS.has(r.kind) && r.gain > 0).map(r => r.dst);
    const hearing = inn.filter(r => (TALK_KINDS.has(r.kind) || LISTEN_KINDS.has(r.kind) || r.kind === 'pgm') && r.gain > 0).map(r => r.src);
    const tState = store.talentOf(g);
    const live = voice.state === 'on' && !voice.muted && (store.port(g)?.kind === 'ifb'
      ? tState.mic && !tState.cough && out.some(r => r.gain > 0) : talking.length > 0);
    status.className = `small vstatus ${live ? 'live' : ''}`;
    status.textContent = voice.state === 'error' ? voice.error
      : voice.state !== 'on' ? 'Audio is off.' : voice.muted ? 'Mic muted.' : live ? 'MIC LIVE' : 'Mic open — no talk key on.';
    const talentPos = store.port(g)?.kind === 'ifb';
    const listeners = out.filter(r => r.gain > 0).map(r => r.dst);
    talk.replaceChildren(el('b', {}, talentPos ? 'Listening to you: ' : 'Talking to: '), names(talentPos ? listeners : talking));
    hear.replaceChildren(el('b', {}, 'Hearing: '), names(hearing));
    if (voice.state === 'on' && !prox.running && prox.status.state === 'off') void prox.start();
    if (voice.state !== 'on' && prox.status.state !== 'off') prox.stop();
    const ps = prox.status;
    const nearMe = store.near.filter(n => n[0] === g || n[1] === g).map(n => store.personOf(n[0] === g ? n[1] : n[0]).name ?? `#${n[0] === g ? n[1] : n[0]}`);
    proxLine.textContent = ps.state === 'off' ? 'Proximity: starts with audio.'
      : ps.state === 'on' ? `Proximity: listening at ${ps.rate} Hz · blips played ${ps.emitted}, measured ${ps.measured}` +
        `${ps.lastSnr !== null ? ` (last ${ps.lastSnr} dB from ${store.portName(ps.lastEmitter ?? 0)})` : ''}` +
        ` · near: ${nearMe.length ? nearMe.join(', ') : 'none learned yet'}`
      : `Proximity: ${ps.state}${ps.note ? ` — ${ps.note}` : ''}`;
    micBar.style.width = `${Math.min(100, voice.micLevel * 400)}%`;
    outBar.style.width = `${Math.min(100, voice.outLevel * 400)}%`;
  };
  voice.onChange = renderVoice;
  const why = Voice.supported();
  renderVoice();
  return el('section', { class: 'card voice' }, el('h2', { class: 'card-h' }, 'Intercom audio'),
    el('div', { class: 'vrow' }, btn, mute, status),
    why ? el('p', { class: 'err small' }, why) : null,
    el('div', { class: 'vmeters' },
      el('label', { class: 'small' }, 'Mic', el('span', { class: 'vbar' }, micBar)),
      el('label', { class: 'small' }, 'Speaker', el('span', { class: 'vbar' }, outBar))),
    talk, hear, proxLine,
    el('p', { class: 'muted small' }, 'Your microphone feeds this station; you hear what the matrix routes to it. Use a headset to avoid echo.'));
}

function showPanel(g: number) {
  gid = g;
  const p = store.port(g)!;
  document.title = `${p.mnemonic.trim() || p.label} · ${p.label} · MicroCOM panel`;
  const keep = new URLSearchParams(location.search);
  keep.delete('p');
  const url = panelHref(p.label, keep);
  if (location.pathname + location.search !== new URL(url, location.href).pathname + new URL(url, location.href).search) history.replaceState(null, '', url);
  const talent = p.kind === 'ifb';
  keypanel = talent ? null : new KeypanelView(store, client);
  turret = talent ? new TurretView(store, client) : null;
  if (turret) turret.onHeadset = v => voice.setOutputGain(v);
  const admin = store.role.admin;
  monitor = admin ? new MonitorView(store) : null;
  const copy = button('Copy link', () => copyLink(copy), { class: 'btn' }) as HTMLButtonElement;
  const mail = el('a', { class: 'btn', href: '#' }, 'Email link');
  mail.addEventListener('click', e => { e.preventDefault(); location.href = mailto(p); });
  const header = el('header', { class: 'top' },
    el('div', { class: 'brand' }, brandMark, el('span', { class: 'brand-x' }, 'Panel'),
      el('span', { class: 'brand-sub' }, `${p.label} · ${fmtF(p.facility)} bus ${p.local}`)),
    connPill, el('div', { class: 'spacer' }), copy, mail,
    admin ? el('a', { class: 'btn', href: pageHref('panels') }, 'All panels') : null,
    admin ? el('a', { class: 'btn', href: pageHref('matrix') }, 'Matrix') : null);
  const help = el('p', { class: 'muted small panel-help' }, talent
    ? 'Talent position: your mic can be listened to by the production; hold COUGH (or Space) to mute it. Your earpiece carries program and anyone talking to your IFB.'
    : 'Click a key to latch it, hold it for momentary talk. With the panel focused, keys 1–9, 0 and A–D work too. ' +
      'On a MicroCOM 2026 panel: arrows / Enter / + − move the map, PgUp / PgDn step through what was said, P replays, K acknowledges, [ ] change production.');
  const view = (keypanel?.root ?? turret!.root);
  app.replaceChildren(header, el('main', { class: `panel-main${talent ? ' talent' : ''}` }, view, help, voiceCard(g),
    monitor ? el('section', { class: 'card panel-mon' }, el('h2', { class: 'card-h' }, 'Simulated monitor (operator)'), monitor.root) : null));
  if (!admin) keypanel?.root.querySelector('.kp-model')?.setAttribute('disabled', '');
  client.requestStation(g);
  client.requestPanelLink(g);
  monitor?.setSelected(g);
  monitor?.update(true);
  view.focus({ preventScroll: true });
}

function showIndex() {
  document.title = 'MicroCOM panels';
  const byFac = new Map<number, Port[]>();
  for (const p of store.ports) {
    if (!(p.hasKeys || (p.termType && p.termType !== '0'))) continue;
    (byFac.get(p.facility) ?? byFac.set(p.facility, []).get(p.facility)!).push(p);
  }
  const filter = el('input', { class: 'inp', type: 'search', placeholder: 'Filter panels (facility, port, mnemonic)…' }) as HTMLInputElement;
  const list = el('div', { class: 'panel-index' });
  const render = () => {
    const q = filter.value.trim().toUpperCase();
    list.replaceChildren(...[...byFac.entries()].map(([f, ps]) => {
      const hits = ps.filter(p => !q || `${p.label} ${p.mnemonic}`.toUpperCase().includes(q));
      return hits.length ? el('section', { class: 'card' }, el('h2', { class: 'card-h' }, fmtF(f)),
        el('div', { class: 'panel-links' }, ...hits.map(p => el('a', { href: panelHref(p.label), class: 'panel-link' },
          el('b', {}, p.mnemonic.trim() || '—'), el('span', { class: 'mono small' }, p.label.split(' ')[1]))))) : null;
    }).filter((x): x is HTMLElement => !!x));
  };
  filter.addEventListener('input', render);
  app.replaceChildren(el('header', { class: 'top' },
    el('div', { class: 'brand' }, el('span', { class: 'brand-mark' }, 'MicroCOM II'), el('span', { class: 'brand-x' }, 'Panels')),
    connPill, el('div', { class: 'spacer' }), el('a', { class: 'btn', href: pageHref('matrix') }, 'Matrix')),
  el('main', { class: 'panel-main' }, filter, list));
  render();
}

function route() {
  const r = resolvePanel(panelRoutePath(), store.ports);
  if (r.kind === 'panel') { if (gid !== r.gid) showPanel(r.gid); return; }
  if (r.kind === 'index') { showIndex(); return; }
  app.replaceChildren(el('main', { class: 'panel-main' }, el('h1', {}, 'No such panel'),
    el('p', {}, `Nothing matches “${r.what}”. `, el('a', { href: pageHref('panels') }, 'See all panels.'))));
}

let routed = false;
store.subscribe(topic => {
  switch (topic) {
    case 'snapshot':
      if (!routed) {
        routed = true;
        // a panel link unlocks exactly one station: always show that one
        if (!store.role.admin && store.role.gid) showPanel(store.role.gid); else route();
      }
      if (gid) { client.requestStation(gid); monitor?.update(true); }
      break;
    case 'routes': keypanel?.updateLamps(); turret?.updateLive(); monitor?.update(); renderVoice(); break;
    case 'station':
      if (store.station?.gid === gid) {
        keypanel?.render();
        if (turret && gid) turret.render(gid);
        brandMark.textContent = isM2026(store.station.panelModel) ? 'MicroCOM 2026' : 'MicroCOM II';
      }
      break;
    case 'near': renderVoice(); break;
    case 'levels': turret?.updateLive(); break;
    case 'conn': renderConn(); break;
  }
});
renderConn();
void resolveEngine().then(() => client.connect());
