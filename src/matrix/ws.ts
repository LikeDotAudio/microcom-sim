// WebSocket client with auto-reconnect; feeds the store and re-requests the selected station.
import type { Store } from './store';
import type { ClientMsg, ServerMsg } from './types';
import { openSocket } from '../local/mode';

export function defaultWsUrl(loc: Location = location): string {
  const forced = new URLSearchParams(loc.search).get('ws');  // ?ws= picks a real engine explicitly
  if (forced) return forced;
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  const k = new URLSearchParams(loc.search).get('k');      // panel-link token, passed through
  return `${proto}//${loc.host}/ws${k ? `?k=${encodeURIComponent(k)}` : ''}`;
}

export class MatrixClient {
  private ws: WebSocket | null = null;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  /** gid whose station view is kept fresh (re-requested after routes/snapshot). */
  watchGid: number | null = null;
  /** binary frames from the engine (intercom audio) */
  onBinary: ((data: ArrayBuffer) => void) | null = null;

  constructor(private store: Store, private url: string = defaultWsUrl()) {}

  connect() {
    this.closed = false;
    const ws = openSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.store.setConnected(true);
    };
    ws.onmessage = ev => {
      if (ev.data instanceof ArrayBuffer) { this.onBinary?.(ev.data); return; }
      let msg: ServerMsg;
      try { msg = JSON.parse(ev.data as string) as ServerMsg; } catch { return; }
      this.store.apply(msg);
      if ((msg.t === 'routes' || msg.t === 'snapshot') && this.watchGid) this.requestStation(this.watchGid);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.store.setConnected(false);
      if (!this.closed) this.schedule();
    };
    ws.onerror = () => ws.close();
  }

  private schedule() {
    const delay = Math.min(5000, 300 * 2 ** this.retry++);
    this.timer = setTimeout(() => this.connect(), delay);
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
  }

  send(msg: ClientMsg): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  sendBinary(data: ArrayBuffer): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.ws.bufferedAmount > 64000) return false;
    this.ws.send(data);
    return true;
  }

  requestPanelLink(gid: number) { this.send({ t: 'panellink', gid }); }

  requestStation(gid: number) {
    this.watchGid = gid;
    this.send({ t: 'station', gid });
  }

  key(gid: number, slot: number, action: 'press' | 'release' | 'toggle') {
    this.send({ t: 'key', gid, slot, action });
  }

  panelModel(gid: number, model: string | null) {
    this.send({ t: 'panelmodel', gid, model });
  }
}
