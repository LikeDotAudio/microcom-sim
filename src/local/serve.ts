// Runs one Host and serves pages over MessagePorts (used by the SharedWorker, or in-page as fallback).
import { Access, newSecret } from './access';
import { Host } from './host';
import { kvGet, kvSet } from './store';
import type { FromEngine, ToEngine } from './wire';

const IDLE_MS = 150_000;         // a page silent this long (closed without 'bye') is dropped

export async function startHost(): Promise<Host> {
  let secret = await kvGet<Uint8Array>('secret');
  if (!(secret instanceof Uint8Array) || secret.length < 16) {
    secret = newSecret();
    await kvSet('secret', secret);
  }
  const state = await kvGet<unknown>('state');
  const profile = Host.profileFrom();
  const access = await Access.create(secret, profile.ports);
  let host: Host;
  try {
    host = new Host(access, profile, { save: s => void kvSet('state', s) }, state);
  } catch {                       // unreadable saved state: start over with the demo
    host = new Host(access, profile, { save: s => void kvSet('state', s) }, null);
  }
  host.start();
  return host;
}

interface Page {
  port: MessagePort;
  seen: number;
  socks: Map<number, ReturnType<Host['connect']>>;
  links: Map<number, { send(b: Uint8Array): void; close(): void }>;
}

export function servePorts(hostP: Promise<Host>) {
  const pages = new Set<Page>();
  const post = (p: Page, m: FromEngine, transfer: Transferable[] = []) => { try { p.port.postMessage(m, transfer); } catch { /* gone */ } };
  const drop = (p: Page) => {
    for (const c of p.socks.values()) c.close();
    for (const l of p.links.values()) l.close();
    p.socks.clear();
    p.links.clear();
    pages.delete(p);
  };
  setInterval(() => { const t = Date.now(); for (const p of [...pages]) if (t - p.seen > IDLE_MS) drop(p); }, 10_000);

  return function attach(port: MessagePort) {
    const page: Page = { port, seen: Date.now(), socks: new Map(), links: new Map() };
    pages.add(page);
    port.onmessage = async ev => {
      const m = ev.data as ToEngine;
      page.seen = Date.now();
      let host: Host;
      try {
        host = await hostP;
      } catch (e) {                // the engine could not start: tell the page why
        if ('id' in m) post(page, { k: 'closed', id: m.id, reason: `local engine failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}` });
        return;
      }
      if (!pages.has(page) && m.k !== 'bye') pages.add(page);
      switch (m.k) {
        case 'open': {
          post(page, { k: 'open', id: m.id });          // before hello/snapshot, as a WebSocket opens first
          const conn = host.connect(m.token, m.page, {
            json: msg => post(page, { k: 'msg', id: m.id, data: JSON.stringify(msg) }),
            binary: b => post(page, { k: 'msg', id: m.id, data: b }, [b]),
          });
          page.socks.set(m.id, conn);
          break;
        }
        case 'msg':
          try { page.socks.get(m.id)?.message(m.data); } catch (e) { console.error('local engine:', e); }
          break;
        case 'close': page.socks.get(m.id)?.close(); page.socks.delete(m.id); break;
        case 'clip': {
          const wav = host.clip(m.token, m.clip);
          post(page, { k: 'clip', id: m.id, wav }, wav ? [wav] : []);
          break;
        }
        case 'link': {
          try {
            page.links.set(m.id, host.attachLink(m.facility, b => post(page, { k: 'lrx', id: m.id, bytes: b })));
          } catch (e) {
            post(page, { k: 'closed', id: m.id, reason: String(e) });
          }
          break;
        }
        case 'ltx': page.links.get(m.id)?.send(m.bytes); break;
        case 'lclose': page.links.get(m.id)?.close(); page.links.delete(m.id); break;
        case 'bye': drop(page); break;
        case 'ping': break;
      }
    };
    port.start();
  };
}
