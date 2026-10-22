// Real engine or local engine? The pages talk to mcommatrix/server.py when it serves them; on a static
// host (GitHub Pages, any plain web server, file previews) they run the engine in the browser.
//   ?ws=URL        always a real engine at URL
//   ?engine=local  always the local engine;  ?engine=remote  always the page's own /ws
//   *.github.io    local
//   otherwise      probe /api/state: JSON (operator) or 403 (panel link) = the Python server is here
import { localClipUrl, openEngineSocket } from './socket';

export type EngineMode = 'local' | 'remote';
let mode: EngineMode | null = null;
let pending: Promise<EngineMode> | null = null;

const params = () => new URLSearchParams(location.search);

async function probe(): Promise<EngineMode> {
  const p = params();
  if (p.has('ws')) return 'remote';
  const forced = p.get('engine');
  if (forced === 'local' || forced === 'remote') return forced;
  if (/\.github\.io$/i.test(location.hostname) || location.protocol === 'file:') return 'local';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2500);
  try {
    const r = await fetch(new URL('/api/state', location.href), { cache: 'no-store', signal: ctl.signal });
    if (r.status === 403) return 'remote';
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) return 'remote';
    return 'local';
  } catch {
    return 'local';
  } finally {
    clearTimeout(timer);
  }
}

/** Decide once per page load; call before connecting. */
export function resolveEngine(): Promise<EngineMode> {
  return (pending ??= probe().then(m => (mode = m)));
}

/** The mode decided by resolveEngine() ('remote' until then). */
export function engineMode(): EngineMode { return mode ?? 'remote'; }
export const isLocal = () => engineMode() === 'local';

/** WebSocket to the engine: the real one, or the local engine's look-alike. */
export function openSocket(url: string): WebSocket {
  return isLocal() ? openEngineSocket(url) : new WebSocket(url);
}

/** Link to another page of the site. Python server: /, /panels, /mc3; static site: sibling .html files. */
export function pageHref(page: 'matrix' | 'panels' | 'mc3'): string {
  if (!isLocal()) return { matrix: '/', panels: '/panels', mc3: '/mc3' }[page];
  return { matrix: 'matrix.html', panels: 'panel.html', mc3: 'mc3.html' }[page];
}

/** A station's panel page: /panel/PROD01/PNL01 (Python server) or panel.html?p=PROD01/PNL01 (static). */
export function panelHref(label: string, keep: URLSearchParams = new URLSearchParams()): string {
  const [fac, name] = label.split(' ');
  const path = `${encodeURIComponent(fac)}/${encodeURIComponent(name)}`;
  if (!isLocal()) {
    const q = keep.toString();
    return `/panel/${path}${q ? `?${q}` : ''}`;
  }
  const q = new URLSearchParams(keep);
  q.delete('p');
  const rest = q.toString();
  return `panel.html?p=${path}${rest ? `&${rest}` : ''}`;
}

/** The panel route of this page as a server-style path (/panel/..., /panels) for resolvePanel():
 * panel.html?p=PROD01/PNL01 or panel.html#PROD01/PNL01 on a static host, the path itself on the server. */
export function panelRoutePath(loc: Pick<Location, 'pathname' | 'search' | 'hash'> = location): string {
  const isPage = /\/panel\.html$/i.test(loc.pathname);
  const q = new URLSearchParams(loc.search).get('p');
  const h = isPage && loc.hash.length > 1 ? decodeURIComponent(loc.hash.slice(1)) : null;
  const p = q ?? h;
  if (p) return `/panel/${p.replace(/^\/+/, '').replace(/^panel\//i, '')}`;
  return isPage ? '/panels' : loc.pathname;
}

/** Audio URL of a recorded talk segment. */
export function clipSrc(id: number, k: string | null): string | Promise<string> {
  if (isLocal()) return localClipUrl(id, k);
  return `/api/clip/${id}.wav${k ? `?k=${encodeURIComponent(k)}` : ''}`;
}
