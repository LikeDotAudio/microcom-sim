// Simulated MicroCOM II frame, serial side (port of mcomtui/matrix_sim.py; protocol in
// specs/05-serial-protocol.md §8).
//
// Idle: ENQ (05h) every ~400 ms. PC answers ACK (06h) -> we send SYN (16h) and collect a 35-byte
// block `01 TYPE BLK ~BLK DATA[30] CHK`. Valid -> ACK (06h), invalid -> CR (0Dh). TYPE AAh is the
// Data Link Test: we answer with 33 bytes (echo of block[1..33]) and expect EOT (04h).
import type { Clock } from './machine';
import { type Backend, MSR_CTS, MSR_DCD, MSR_DSR } from './uart';

const ENQ = 0x05, ACK = 0x06, SYN = 0x16, SOH = 0x01, CR = 0x0D, EOT = 0x04;

export const BLOCK_TYPES: Record<number, string> = {
  0x0F: 'Index', 0x0A: 'Keypad', 0x0D: 'Overlay', 0x50: 'Relay', 0xA6: 'IFB/PGM',
  0xA5: 'Camera/ISO', 0xA9: 'Call Array', 0xA0: 'EPC', 0xF0: 'Terminal', 0xAA: 'Link test',
};

export function checksum(data: Uint8Array): number {
  let s = 0;
  for (const b of data) s += b;
  return s === 0 ? 0 : ((s - 1) % 128) + 1;
}

const hexs = (d: Uint8Array) => Array.from(d, b => b.toString(16).padStart(2, '0')).join(' ');

/** Options (comma separated): offline, nak=N (reject every Nth block), busy. */
export class MatrixSim implements Backend {
  name = 'simulated matrix';
  offline: boolean;
  private readonly nakEvery: number;
  private readonly busy: boolean;
  private out: number[] = [];
  private state: 'idle' | 'recv' | 'eot' = 'idle';
  private block: number[] = [];
  private nextEnq = 0;
  private deadline = 0;
  private blocksSeen = 0;
  readonly received: Uint8Array[] = [];

  constructor(readonly clock: Clock, options = '', readonly log: (line: string) => void = () => {}) {
    const opts = new Map(options.split(',').filter(Boolean).map(o => [o.split('=')[0], o.split('=')[1] ?? ''] as const));
    this.offline = opts.has('offline');
    this.nakEvery = Number(opts.get('nak') || 0);
    this.busy = opts.has('busy');
    this.note('simulator started' + (options ? ` (${options})` : ''));
  }

  private note(text: string) {
    const t = this.clock.wall();
    const p = (n: number) => String(n).padStart(2, '0');
    this.log(`${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())} ${text}`);
  }

  modem() { return this.offline ? 0 : MSR_CTS | MSR_DSR | MSR_DCD; }

  read(): Uint8Array {
    const now = this.clock.now();
    if (this.offline) return new Uint8Array(0);
    if (this.state !== 'idle' && now > this.deadline) {
      this.note(`timeout in state ${this.state} (${this.block.length} bytes)`);
      this.state = 'idle';
      this.block = [];
    }
    if (this.state === 'idle' && now >= this.nextEnq) {
      this.out.push(this.busy ? 0x11 : ENQ);
      this.nextEnq = now + 0.4;
    }
    const data = Uint8Array.from(this.out);
    this.out = [];
    return data;
  }

  write(data: Uint8Array) {
    if (this.offline) return;
    for (const b of data) this.byte(b);
  }

  private byte(b: number) {
    const now = this.clock.now();
    if (this.state === 'idle') {
      if (b === ACK) {
        this.out.push(SYN);
        this.state = 'recv';
        this.block = [];
        this.deadline = now + 2;
      }
    } else if (this.state === 'recv') {
      this.block.push(b);
      this.deadline = now + 2;
      if (this.block.length === 35) this.blockDone(Uint8Array.from(this.block));
    } else {
      if (b === EOT) this.note('link test round complete (EOT)');
      this.state = 'idle';
      this.nextEnq = now + 0.2;
    }
  }

  private blockDone(blk: Uint8Array) {
    this.blocksSeen++;
    const typ = blk[1], num = blk[2], comp = blk[3], data = blk.subarray(4, 34), chk = blk[34];
    const name = BLOCK_TYPES[typ] ?? `type ${typ.toString(16).toUpperCase().padStart(2, '0')}`;
    if (typ === 0xAA) {
      this.note(`link test block: ${hexs(blk)}`);
      this.out.push(...Array.from(blk.subarray(1, 34), b => (b === ENQ ? 0 : b)));
      this.state = 'eot';
      this.deadline = this.clock.now() + 5;
      return;
    }
    const ok = blk[0] === SOH && comp === 0xFF - num && chk === checksum(data);
    const forced = this.nakEvery > 0 && this.blocksSeen % this.nakEvery === 0;
    const verdict = ok && !forced ? 'ACK' : ok ? 'NAK (forced)' : 'NAK (bad block)';
    this.note(`${name.padEnd(11)} blk ${String(num).padStart(3)}  ${hexs(data)}  chk ${chk.toString(16).toUpperCase().padStart(2, '0')}  -> ${verdict}`);
    if (verdict === 'ACK') this.received.push(blk);
    this.out.push(verdict === 'ACK' ? ACK : CR);
    this.state = 'idle';
    this.nextEnq = this.clock.now() + 0.2;
  }
}
