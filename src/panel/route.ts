// Panel URLs: /panel/<gid> | /panel/F01/PNL01 (port label) | /panel/F01/DIR (facility + mnemonic); /panels = index.
import type { Port } from '../matrix/types';

export type PanelRoute = { kind: 'index' } | { kind: 'panel'; gid: number } | { kind: 'unknown'; what: string };

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '');

/** Canonical, readable URL path for a port: /panel/F01/PNL01. */
export function panelPath(p: Pick<Port, 'label'>): string {
  const [fac, name] = p.label.split(' ');
  return `/panel/${encodeURIComponent(fac)}/${encodeURIComponent(name)}`;
}

/** Resolve a location pathname against the matrix ports (ports must be loaded). */
export function resolvePanel(pathname: string, ports: Port[]): PanelRoute {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'panels' || (parts[0] === 'panel' && parts.length === 1)) return { kind: 'index' };
  if (parts[0] !== 'panel') return { kind: 'unknown', what: pathname };
  const rest = parts.slice(1);
  if (rest.length === 1 && /^\d+$/.test(rest[0])) {
    const gid = Number(rest[0]);
    return ports.some(p => p.gid === gid) ? { kind: 'panel', gid } : { kind: 'unknown', what: rest[0] };
  }
  const fm = /^(?:PROD|F|P)?0*(\d+)$/i.exec(rest[0] ?? '');
  if (fm && rest.length === 2) {
    const f = Number(fm[1]) - 1;
    const name = norm(rest[1]);
    const inFac = ports.filter(p => p.facility === f);
    const byLabel = inFac.find(p => norm(p.label.split(' ')[1] ?? '') === name);
    const byMn = inFac.find(p => norm(p.mnemonic) === name);
    const byLocal = /^\d+$/.test(name) ? inFac.find(p => p.local === Number(name)) : undefined;
    const hit = byLabel ?? byMn ?? byLocal;
    if (hit) return { kind: 'panel', gid: hit.gid };
  }
  return { kind: 'unknown', what: rest.join('/') };
}
