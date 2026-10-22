// The page side of the local engine: a WebSocket look-alike (openEngineSocket) and the frame link
// byte stream (openFrameLink), both multiplexed over one MessagePort to the engine's SharedWorker.
// Without SharedWorker support the engine runs inside this page instead (other tabs then have their own).
import type { FrameLink } from './frameLink';
import type { FromEngine, ToEngine } from './wire';

let port: MessagePort | null = null;
let nextId = 1;
const handlers = new Map<number, (m: FromEngine) => void>();

function engineKind(): 'shared' | 'inpage' {
  return typeof SharedWorker !== 'undefined' ? 'shared' : 'inpage';
}

function getPort(): MessagePort {
  if (port) return port;
  if (engineKind() === 'shared') {
    const w = new SharedWorker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'mcom-engine' });
    port = w.port;
  } else {
    const ch = new MessageChannel();
    port = ch.port1;
    void import('./serve').then(({ servePorts, startHost }) => servePorts(startHost())(ch.port2));
  }
  port.onmessage = ev => {
    const m = ev.data as FromEngine;
    handlers.get(m.id)?.(m);
  };
  port.start();
  setInterval(() => post({ k: 'ping' }), 3000);
  addEventListener('pagehide', () => post({ k: 'bye' }));
  return port;
}

function post(m: ToEngine, transfer: Transferable[] = []) { getPort().postMessage(m, transfer); }

/** How the local engine is running: one SharedWorker for all tabs, or inside this page. */
export const localEngineKind = engineKind;

const CONNECTING = 0, OPEN = 1, CLOSING = 2, CLOSED = 3;

/** WebSocket-compatible connection to the local engine (what server.py's /ws is to a real one).
 * The url's ?k= panel token (if any) selects the role, exactly as on the Python server. */
export class LocalSocket {
  static readonly CONNECTING = CONNECTING;
  static readonly OPEN = OPEN;
  static readonly CLOSING = CLOSING;
  static readonly CLOSED = CLOSED;
  readonly url: string;
  readyState = CONNECTING;
  binaryType: BinaryType = 'arraybuffer';
  bufferedAmount = 0;
  protocol = '';
  extensions = '';
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent | Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  private id = nextId++;

  constructor(url: string) {
    this.url = url;
    let token: string | null = null;
    try { token = new URL(url, location.href).searchParams.get('k'); } catch { /* no token */ }
    handlers.set(this.id, m => this.onEngine(m));
    post({ k: 'open', id: this.id, token, page: location.href });
  }

  private onEngine(m: FromEngine) {
    if (m.k === 'open') {
      if (this.readyState !== CONNECTING) return;
      this.readyState = OPEN;
      this.onopen?.(new Event('open'));
    } else if (m.k === 'msg') {
      if (this.readyState !== OPEN) return;
      this.onmessage?.(new MessageEvent('message', { data: m.data }));
    } else if (m.k === 'closed') {
      if (m.reason) console.error(m.reason);
      this.finish();
    }
  }

  send(data: string | ArrayBuffer | ArrayBufferView) {
    if (this.readyState !== OPEN) throw new DOMException('LocalSocket is not open', 'InvalidStateError');
    if (typeof data === 'string') { post({ k: 'msg', id: this.id, data }); return; }
    const buf = data instanceof ArrayBuffer ? data.slice(0)
      : (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength);
    post({ k: 'msg', id: this.id, data: buf }, [buf]);
  }

  close() {
    if (this.readyState >= CLOSING) return;
    post({ k: 'close', id: this.id });
    this.finish();
  }

  private finish() {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    handlers.delete(this.id);
    queueMicrotask(() => this.onclose?.(new Event('close')));
  }

  addEventListener(type: string, fn: (ev: Event) => void) {
    const key = `on${type}` as 'onopen';
    const prev = this[key];
    this[key] = ev => { prev?.(ev as never); fn(ev); };
  }
}

export function openEngineSocket(url: string): WebSocket {
  return new LocalSocket(url) as unknown as WebSocket;
}

/** A recorded talk segment from the local engine (server.py /api/clip/<id>.wav), as a blob: URL. */
export function localClipUrl(clip: number, token: string | null): Promise<string> {
  return new Promise((res, rej) => {
    const id = nextId++;
    handlers.set(id, m => {
      if (m.k !== 'clip') return;
      handlers.delete(id);
      if (!m.wav) { rej(new Error('clip unavailable')); return; }
      res(URL.createObjectURL(new Blob([m.wav], { type: 'audio/wav' })));
    });
    post({ k: 'clip', id, token, clip });
  });
}

/** Byte stream to facility f's emulated frame (the TCP 7000+f link of the Python engine). */
export function openFrameLinkImpl(facility: number): FrameLink {
  const id = nextId++;
  const cbs: ((b: Uint8Array) => void)[] = [];
  let open = true;
  handlers.set(id, m => {
    if (m.k === 'lrx') for (const cb of cbs) cb(m.bytes);
    else if (m.k === 'closed') { open = false; handlers.delete(id); }
  });
  post({ k: 'link', id, facility });
  return {
    send(bytes) { if (open) post({ k: 'ltx', id, bytes: Uint8Array.from(bytes) }); },
    onData(cb) { cbs.push(cb); },
    close() { if (!open) return; open = false; post({ k: 'lclose', id }); handlers.delete(id); },
  };
}
