// Web matrix UI entry: wires the WS client/store to the views.
import './style.css';
import { button, el, fmtF, panel } from './dom';
import { ExtKeysView } from './extkeys';
import { FacilityView } from './facility';
import { GridView } from './grid';
import { KeypanelView } from './keypanel';
import { TurretView } from './turret';
import { LogView } from './log';
import { MonitorView } from './monitor';
import { PortsView } from './ports';
import { Store } from './store';
import { panelHref, resolveEngine } from '../local/mode';
import { MatrixClient } from './ws';

const store = new Store();
const client = new MatrixClient(store);

const ui = { facility: -1, selected: null as number | null };
try {
  const saved = JSON.parse(localStorage.getItem('mcom-matrix-ui') ?? '{}');
  if (typeof saved.facility === 'number') ui.facility = saved.facility;
  if (typeof saved.selected === 'number') ui.selected = saved.selected;
} catch { /* storage unavailable */ }
const persist = () => {
  try { localStorage.setItem('mcom-matrix-ui', JSON.stringify(ui)); } catch { /* ignore */ }
};

// ---- header ------------------------------------------------------------------------------
const connPill = el('span', { class: 'pill off' }, 'connecting…');
const title = el('span', { class: 'brand-sub' }, '');
const counts = el('div', { class: 'counts' });
const facSel = el('select', { class: 'inp', 'aria-label': 'Facility' }, el('option', { value: '-1' }, 'All facilities'));
const errBox = el('span', { class: 'err small' });
facSel.addEventListener('change', () => setFacility(Number(facSel.value)));
const header = el('header', { class: 'top' },
  el('div', { class: 'brand' }, el('span', { class: 'brand-mark' }, 'MicroCOM II'), el('span', { class: 'brand-x' }, 'Matrix'), title),
  connPill, counts,
  el('div', { class: 'spacer' }), errBox,
  el('label', { class: 'small muted' }, 'Facility '), facSel,
  button('Clear all keys', () => {
    if (confirm('Release every latched key and external trigger on the whole matrix?')) client.send({ t: 'clear' });
  }, { class: 'btn danger' }));

function renderCounts() {
  const c = (n: number | string, l: string, cls = '') => el('span', { class: `count ${cls}` }, el('b', {}, String(n)), ` ${l}`);
  counts.replaceChildren(
    c(store.activeRouteCount(), 'routes'),
    c(store.active.size, 'keys on'),
    c(store.closedRelayCount(), 'relays closed', store.closedRelayCount() ? 'warn' : ''),
    c(`${store.connectedLinkCount()}/${store.links.size}`, 'MCOM links', store.connectedLinkCount() ? 'ok' : ''));
}

function renderConn() {
  connPill.className = `pill ${store.connected ? 'on' : 'off'}`;
  connPill.textContent = store.connected ? 'live' : 'reconnecting…';
}

// ---- views ---------------------------------------------------------------------------------
const grid = new GridView(store);
const ports = new PortsView(store);
const keypanel = new KeypanelView(store, client);
const turret = new TurretView(store, client);
const extkeys = new ExtKeysView(store, client);
const facility = new FacilityView(store, client);
const log = new LogView(store);
const monitor = new MonitorView(store);

grid.onSelect = g => select(g);
ports.onSelect = g => select(g);

const pGrid = panel('Crosspoints', grid.root);
const pPorts = panel('Ports', ports.root);
const pKeys = panel('Keypanel', keypanel.root, turret.root);
const isTalent = (gid: number | null) => !!gid && store.port(gid)?.kind === 'ifb';
function showStationView() {
  const talent = isTalent(ui.selected);
  keypanel.root.hidden = talent;
  turret.root.hidden = !talent;
  if (talent && ui.selected) turret.render(ui.selected);
}
const pExt = panel('Extended keys', extkeys.root);
const pFac = panel('Facility', facility.root);
const pLog = panel('Event log', log.root);
const pMon = panel('Monitor', monitor.root);
pGrid.root.classList.add('a-grid');
pPorts.root.classList.add('a-ports');
pKeys.root.classList.add('a-kp');
pExt.root.classList.add('a-ext');
pFac.root.classList.add('a-fac');
pLog.root.classList.add('a-log');
pMon.root.classList.add('a-mon');
const openPanel = el('a', { class: 'btn small open-panel', target: '_blank', rel: 'noopener', title: 'Open this station on its own page (shareable link)' }, 'Open panel ↗');
const shareBtn = button('Share link', () => { if (ui.selected) client.requestPanelLink(ui.selected); }, { class: 'btn small', title: 'Get a link that opens only this panel (for email)' });
const shareBox = el('div', { class: 'share-box', hidden: '' });
pKeys.head.append(el('span', { class: 'muted small' }, 'click = latch · hold = momentary · keys 1–9 0 A–D'), el('span', { class: 'spacer' }), shareBtn, openPanel);
pKeys.body.prepend(shareBox);

function showShare(gid: number, url: string) {
  const p = store.port(gid);
  if (!p || gid !== ui.selected) return;
  const name = p.mnemonic.trim() || p.label;
  const input = el('input', { class: 'inp mono', readonly: '', value: url }) as HTMLInputElement;
  const body = `Your MicroCOM intercom panel: ${name} (${p.label})\n\n${url}\n\nOpen it on the same network. ` +
    "The first time, accept the matrix's self-signed certificate (Advanced → Proceed), then press " +
    "'Join intercom audio' and allow the microphone. A headset avoids echo.\n";
  const copy = button('Copy', async () => {
    try { await navigator.clipboard.writeText(url); copy.textContent = 'Copied'; } catch { input.select(); }
  }, { class: 'btn small' });
  shareBox.replaceChildren(el('b', { class: 'small' }, `Link for ${name} — opens only this panel:`), input, copy,
    el('a', { class: 'btn small', href: `mailto:?subject=${encodeURIComponent(`Intercom panel ${name}`)}&body=${encodeURIComponent(body)}` }, 'Email'),
    button('×', () => { shareBox.hidden = true; }, { class: 'btn small', title: 'Close' }));
  shareBox.hidden = false;
  input.select();
}
pGrid.head.append(el('span', { class: 'muted small' }, 'rows = sources (inputs) · columns = destinations (outputs) · wheel zoom · drag pan · click selects source'));

const app = el('main', { class: 'layout' }, pGrid.root, pKeys.root, pMon.root, pPorts.root, pFac.root, pExt.root, pLog.root);
document.getElementById('app')!.replaceChildren(header, app);

// ---- selection --------------------------------------------------------------------------------
function facilityForPanel() {
  return ui.facility >= 0 ? ui.facility : ui.selected ? store.facilityOf(ui.selected) : 0;
}

function select(gid: number) {
  if (!store.port(gid)) return;
  ui.selected = gid;
  persist();
  openPanel.setAttribute('href', panelHref(store.port(gid)!.label));
  shareBox.hidden = true;
  client.requestStation(gid);
  grid.setSelected(gid);
  ports.setSelected(gid);
  monitor.setSelected(gid);
  extkeys.setStation(gid);
  if (facility.facility !== facilityForPanel()) facility.setFacility(facilityForPanel());
}

function setFacility(f: number) {
  ui.facility = f;
  persist();
  facSel.value = String(f);
  grid.setFacility(f);
  ports.setFacility(f);
  facility.setFacility(facilityForPanel());
  if (f >= 0 && (!ui.selected || store.facilityOf(ui.selected) !== f)) select(store.gid(f, 1));
}

// ---- store wiring ------------------------------------------------------------------------------
let first = true;
store.subscribe(topic => {
  switch (topic) {
    case 'snapshot':
      title.textContent = store.profile ? `${store.profile.name} · ${store.profile.ports} ports · ${store.profile.facilities}×${store.profile.slice}` : '';
      if (facSel.options.length !== store.facilityCount + 1) {
        facSel.replaceChildren(el('option', { value: '-1' }, 'All facilities'),
          ...Array.from({ length: store.facilityCount }, (_, f) => el('option', { value: f }, fmtF(f))));
      }
      if (ui.facility >= store.facilityCount) ui.facility = -1;
      facSel.value = String(ui.facility);
      renderCounts();
      log.reset();
      if (first) {
        first = false;
        grid.facility = ui.facility;
        grid.fit();
        ports.facility = ui.facility;
        select(ui.selected && store.port(ui.selected) ? ui.selected : 1);
      }
      grid.draw();
      ports.render();
      facility.setFacility(facilityForPanel());
      extkeys.refresh();
      monitor.update(true);
      break;
    case 'routes':
      renderCounts();
      grid.draw();
      ports.updateTally();
      facility.renderLive();
      keypanel.updateLamps();
      turret.updateLive();
      monitor.update();
      break;
    case 'event': {
      const e = store.events[store.events.length - 1];
      if (e) log.add(e);
      break;
    }
    case 'links':
      renderCounts();
      facility.renderLink();
      break;
    case 'station':
      if (!store.station || store.station.gid === ui.selected) { keypanel.render(); showStationView(); }
      break;
    case 'levels':
      if (isTalent(ui.selected)) turret.updateLive();
      break;
    case 'error':
      errBox.textContent = store.lastError;
      setTimeout(() => { if (errBox.textContent === store.lastError) errBox.textContent = ''; }, 6000);
      break;
    case 'conn':
      renderConn();
      break;
    case 'panellink': {
      const m = store.panelLinks;
      if (ui.selected && m.has(ui.selected)) showShare(ui.selected, m.get(ui.selected)!);
      break;
    }
  }
});

renderConn();
void resolveEngine().then(() => client.connect());

// debugging / automation hook
(window as unknown as { mcom: unknown }).mcom = { store, client, select, setFacility, grid, monitor };
