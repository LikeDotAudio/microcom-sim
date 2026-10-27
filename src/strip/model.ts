// The key strip's decisions, kept apart from the page so they can be tested: which ports are panels, which
// keys a strip of N shows, what each key says, and which station is "mine".
import { keyTarget } from '../m2026/labels';
import type { Port, Station, StationKey } from '../matrix/types';

/** Where the strip remembers the station it was last set to (per browser, like a panel's read state). */
export const STATION_KEY = 'microcom.strip.station';

/** Keys a strip shows unless the page asks for another number (?keys=N). */
export const DEFAULT_KEYS = 12;

/** One key's width on the strip with its gap, px (style.css: 40 px and 3 px). */
export const KEY_PX = 43;

/** How many keys fit in `room` px once the rest of the strip (`chrome` px) is laid out: at least one, at most `max`. */
export function keysThatFit(room: number | null, chrome: number, max: number): number {
  if (!room || room <= 0) return max;
  return Math.max(1, Math.min(max, Math.floor((room - chrome) / KEY_PX)));
}

/** Ports that are a key panel: they have keys, or an MCOM terminal type. Talent positions (IFB) have no keys. */
export function panelPorts(ports: Port[]): Port[] {
  return ports.filter(p => p.kind !== 'ifb' && (p.hasKeys || (!!p.termType && p.termType !== '0')));
}

/** One key on the strip: its slot, its 4-character LED legend, who it reaches, and its tooltip. */
export interface StripKey { slot: number; legend: string; target: number | null; title: string }

/** The first `max` keys that do something, in slot order, as the panel's own LED legends write them. */
export function stripKeys(st: Pick<Station, 'keys'>, max: number, nameOf: (gid: number) => string = String): StripKey[] {
  return st.keys
    .filter(k => k.kind !== 'empty')
    .sort((a, b) => a.slot - b.slot)
    .slice(0, Math.max(0, max))
    .map(k => ({ slot: k.slot, legend: legendOf(k), target: keyTarget(k), title: titleOf(k, nameOf) }));
}

function legendOf(k: StationKey): string {
  const name = k.kind === 'phantom' ? k.name.replace(/\d+$/, '') : k.name;
  return name.trim().slice(0, 4).toUpperCase() || k.label;
}

function titleOf(k: StationKey, nameOf: (gid: number) => string): string {
  const t = keyTarget(k);
  if (k.kind === 'bus' && t !== null) return `${k.label}: ${k.name.trim()} → ${nameOf(t)}${k.mode ? ` (${k.mode})` : ''}`;
  if (k.kind === 'ext') return `${k.label}: extended → ${(k.targets ?? []).map(nameOf).join(', ')}`;
  return `${k.label}: ${k.name.trim()}`;
}

/** Which station is mine: the page's ?p= (PROD01/PNL02), else the one remembered, else the first panel. */
export function chooseStation(ports: Port[], asked: string | null, remembered: string | null): Port | null {
  const panels = panelPorts(ports);
  const byLabel = (label: string | null) => {
    if (!label) return undefined;
    const want = label.replace('/', ' ').trim().toUpperCase();
    return panels.find(p => p.label.toUpperCase() === want);
  };
  return byLabel(asked) ?? byLabel(remembered) ?? panels[0] ?? null;
}

/** A station's name on the strip: its mnemonic and its port (PRD · PNL02), or the port alone. */
export function stationName(p: Pick<Port, 'label' | 'mnemonic'>): string {
  const port = p.label.split(' ')[1] ?? p.label;
  const mn = p.mnemonic.trim();
  return mn ? `${mn} · ${port}` : port;
}
