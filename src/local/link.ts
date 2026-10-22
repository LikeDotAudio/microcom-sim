// The matrix side of the MCOM serial link (spec 05 §3, §4, §8), port of mcommatrix/link.py. In the
// browser there is no TCP: a client (the in-browser 8086 running MCOM.EXE) attaches a byte stream. We
// behave like a MicroCOM II frame: ENQ every 400 ms while idle, ACK -> SYN, receive a 35-byte block,
// ACK (06) or reject (CR).
import type { Engine } from './engine';
import type { Pending } from './config';
import { now } from './engine';

export const ENQ = 0x05, ACK = 0x06, SYN = 0x16, SOH = 0x01, CR = 0x0d, EOT = 0x04, DC1 = 0x11;

const TYPE_NAMES: Record<number, string> = { 0x0f: 'Index', 0x0a: 'Keypad', 0x0d: 'Overlay', 0x50: 'Relay',
  0xa6: 'IFB/PGM', 0xa5: 'Camera/ISO', 0xa9: 'Call Array', 0xa0: 'EPC', 0xf0: 'Terminal', 0xaa: 'Link test' };

export function checksum(data: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i];
  return s === 0 ? 0 : ((s - 1) % 128) + 1;
}

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

/** Incoming byte queue with timed reads (the asyncio StreamReader equivalent). */
export class ByteReader {
  private buf: number[] = [];
  private waiter: (() => void) | null = null;
  eof = false;

  push(b: ArrayLike<number>) {
    for (let i = 0; i < b.length; i++) this.buf.push(b[i] & 0xff);
    this.wake();
  }

  end() { this.eof = true; this.wake(); }

  private wake() { const w = this.waiter; this.waiter = null; w?.(); }

  private wait(ms: number): Promise<void> {
    return new Promise(res => {
      const t = setTimeout(() => { if (this.waiter === done) this.waiter = null; res(); }, ms);
      const done = () => { clearTimeout(t); res(); };
      this.waiter = done;
    });
  }

  /** Up to max bytes as soon as any are there (null on timeout or EOF). */
  async read(max: number, timeoutS: number): Promise<number[] | null> {
    const deadline = Date.now() + timeoutS * 1000;
    while (!this.buf.length) {
      if (this.eof) throw new LinkClosed();
      const left = deadline - Date.now();
      if (left <= 0) return null;
      await this.wait(left);
    }
    return this.buf.splice(0, max);
  }

  async read1(timeoutS: number): Promise<number | null> {
    const d = await this.read(1, timeoutS);
    return d ? d[0] : null;
  }

  async readn(n: number, timeoutS: number): Promise<Uint8Array | null> {
    const deadline = Date.now() + timeoutS * 1000;
    while (this.buf.length < n) {
      if (this.eof) throw new LinkClosed();
      const left = deadline - Date.now();
      if (left <= 0) return null;
      await this.wait(left);
    }
    return Uint8Array.from(this.buf.splice(0, n));
  }
}

export class LinkClosed extends Error {}

export interface Faults { offline: boolean; nak_every: number; busy: boolean }

export class FacilityLink {
  clients = 0;
  faults: Faults = { offline: false, nak_every: 0, busy: false };
  blocks = 0;
  lastRx = 0;

  constructor(private engine: Engine, readonly facility: number, readonly port: number) {}

  status() {
    return { facility: this.facility, port: this.port, connected: this.clients > 0, faults: this.faults,
      blocks: this.blocks, lastRx: this.lastRx };
  }

  /** A PC attached: run the frame side until the reader ends. write() sends bytes to the PC. */
  async serve(reader: ByteReader, write: (b: Uint8Array) => void, peer = 'this browser') {
    this.clients += 1;
    const f = this.facility;
    this.engine.log('link', `MCOM connected from ${peer}`, f);
    this.engine.changed('links');
    const pending: Pending = new Map();
    const upload = { name: null as string | null, count: 0 };
    try {
      while (!reader.eof) {
        if (this.faults.offline) { await reader.read(256, 0.4); continue; }
        write(Uint8Array.of(this.faults.busy ? DC1 : ENQ));
        const b = await reader.read1(0.4);
        if (b !== ACK) {
          if (upload.name && now() - this.lastRx > 2.5) this.flush(upload);
          continue;
        }
        write(Uint8Array.of(SYN));
        const block = await reader.readn(35, 2.0);
        if (!block) { this.engine.log('link', 'block timeout (incomplete block)', f); continue; }
        this.lastRx = now();
        if (block[1] === 0xaa) {                             // Data Link Test: echo 33 bytes
          write(block.slice(1, 34).map(x => (x === ENQ ? 0 : x)));
          await reader.read1(5.0);                           // EOT
          this.engine.log('link', 'Data Link Test round OK', f);
          continue;
        }
        let ok: boolean | null = FacilityLink.valid(block);
        this.blocks += 1;
        if (ok && this.faults.nak_every && this.blocks % this.faults.nak_every === 0) ok = null;
        write(Uint8Array.of(ok ? ACK : CR));
        if (!ok) {
          this.engine.log('link', `block ${hex2(block[1])}/${block[2]} rejected (${ok === null ? 'fault injection' : 'bad block'})`, f);
          continue;
        }
        const name = TYPE_NAMES[block[1]] ?? `type ${hex2(block[1])}`;
        if (upload.name !== null && upload.name !== name) this.flush(upload);
        upload.name = name;
        upload.count += 1;
        this.engine.applyBlock(f, block[1], block[2], block.subarray(4, 34), pending);
      }
    } catch (e) {
      if (!(e instanceof LinkClosed)) throw e;
    } finally {
      this.flush(upload);
      this.clients -= 1;
      this.engine.log('link', 'MCOM disconnected', f);
      this.engine.changed('links');
    }
  }

  private flush(upload: { name: string | null; count: number }) {
    if (upload.name) {
      this.engine.log('upload', `${upload.name} upload received (${upload.count} blocks)`, this.facility);
      upload.name = null;
      upload.count = 0;
    }
  }

  static valid(b: Uint8Array): boolean {
    return b[0] === SOH && b[3] === 0xff - b[2] && b[34] === checksum(b.subarray(4, 34));
  }
}
