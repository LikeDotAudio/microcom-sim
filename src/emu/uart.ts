// 8250/16450 UART with pluggable back-ends and a byte-level traffic log (port of mcomtui/uart.py).
import type { Clock, Machine } from './machine';

const LCR_DLAB = 0x80;
const LSR_DR = 0x01, LSR_THRE = 0x20, LSR_TEMT = 0x40;
export const MSR_CTS = 0x10, MSR_DSR = 0x20, MSR_RI = 0x40, MSR_DCD = 0x80;
const PARITY: Record<number, string> = { 0: 'N', 1: 'O', 3: 'E', 5: 'M', 7: 'S' };

/** What is plugged into the serial port. */
export interface Backend {
  name: string;
  write(data: Uint8Array): void;
  read(): Uint8Array;
  modem(): number;                 // MSR status bits (CTS/DSR/DCD/RI)
  configure?(baud: number, bits: number, parity: string, stop: number): void;
  close?(): void;
}

export const nullBackend = (): Backend => ({
  name: 'none', write() {}, read: () => new Uint8Array(0), modem: () => 0,
});

/** serial.log lines: time, direction, up to 16 bytes as hex and text. */
export class TrafficLog {
  private dir: string | null = null;
  private line: number[] = [];
  readonly t0: number;
  constructor(readonly clock: Clock, readonly out: (line: string) => void) { this.t0 = clock.now(); }

  private stamp() { return (this.clock.now() - this.t0).toFixed(3).padStart(10); }

  add(direction: string, data: Uint8Array) {
    if (direction !== this.dir || this.line.length >= 16) {
      this.flush();
      this.dir = direction;
    }
    this.line.push(...data);
  }
  note(text: string) {
    this.flush();
    this.out(`${this.stamp()}  --  ${text}`);
  }
  flush() {
    if (!this.line.length) return;
    const hexs = this.line.map(b => b.toString(16).padStart(2, '0')).join(' ');
    const text = this.line.map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    this.out(`${this.stamp()}  ${this.dir}  ${hexs.padEnd(48)}  ${text}`);
    this.line = [];
  }
}

export class Uart {
  private dll = 12; private dlm = 0;         // 9600 baud
  private ier = 0; private lcr = 0; private mcr = 0; private scr = 0;
  private readonly rx: number[] = [];
  private lastMsr = 0;
  private thrEmptyPending = false;
  private config = '';

  constructor(readonly m: Machine, readonly base: number, readonly irqInt: number, public backend: Backend,
              readonly log: TrafficLog, readonly name: string) {
    for (let i = 0; i < 8; i++) {
      m.portIn.set(base + i, () => this.readReg(i));
      m.portOut.set(base + i, v => this.writeReg(i, v));
    }
  }

  readReg(r: number): number {
    switch (r) {
      case 0: {
        if (this.lcr & LCR_DLAB) return this.dll;
        this.poll();
        const b = this.rx.shift();
        if (b === undefined) return 0;
        this.log.add('RX', Uint8Array.of(b));
        return b;
      }
      case 1: return this.lcr & LCR_DLAB ? this.dlm : this.ier;
      case 2:
        this.poll();
        if (this.ier & 1 && this.rx.length) return 0x04;
        if (this.ier & 2 && this.thrEmptyPending) { this.thrEmptyPending = false; return 0x02; }
        if (this.ier & 8 && this.msrChanged()) return 0x00;
        return 0x01;
      case 3: return this.lcr;
      case 4: return this.mcr;
      case 5: this.poll(); return LSR_THRE | LSR_TEMT | (this.rx.length ? LSR_DR : 0);
      case 6: return this.msr();
      default: return this.scr;
    }
  }

  writeReg(r: number, v: number) {
    if (r === 0) {
      if (this.lcr & LCR_DLAB) { this.dll = v; this.reconfigure(); return; }
      this.log.add('TX', Uint8Array.of(v));
      if (this.mcr & 0x10) this.rx.push(v);              // loopback mode
      else this.backend.write(Uint8Array.of(v));
      this.thrEmptyPending = true;
      if (this.ier & 2) this.m.raiseIrq(this.irqInt);
    } else if (r === 1) {
      if (this.lcr & LCR_DLAB) { this.dlm = v; this.reconfigure(); }
      else { this.ier = v & 0x0F; if (v & 2) this.thrEmptyPending = true; }
    } else if (r === 3) { this.lcr = v; this.reconfigure(); }
    else if (r === 4) this.mcr = v;
    else if (r === 7) this.scr = v;
  }

  private msr(): number {
    let cur: number;
    if (this.mcr & 0x10) {                                 // loopback: RTS->CTS, DTR->DSR, OUT1->RI, OUT2->DCD
      cur = (this.mcr & 2 ? MSR_CTS : 0) | (this.mcr & 1 ? MSR_DSR : 0) | (this.mcr & 4 ? MSR_RI : 0) | (this.mcr & 8 ? MSR_DCD : 0);
    } else cur = this.backend.modem();
    const delta = ((cur ^ this.lastMsr) >> 4) & 0x0F;
    this.lastMsr = cur;
    return cur | delta;
  }
  private msrChanged() { return !!(this.msr() & 0x0F); }

  private reconfigure() {
    const div = (this.dlm << 8) | this.dll;
    if (!div) return;
    const baud = Math.round(115200 / div);
    const bits = 5 + (this.lcr & 3);
    const parity = PARITY[(this.lcr >> 3) & 7] ?? 'N';
    const stop = this.lcr & 4 ? 2 : 1;
    const cfg = `${baud} ${bits}${parity}${stop}`;
    if (cfg !== this.config && !(this.lcr & LCR_DLAB)) {
      this.config = cfg;
      this.log.note(`${this.name} configured ${cfg}`);
      this.backend.configure?.(baud, bits, parity, stop);
    }
  }

  // ---- BIOS INT 14h (what MCOM.EXE actually uses, via _bios_serialcom) ----------------------
  private static readonly BIOS_BAUDS = [110, 150, 300, 600, 1200, 2400, 4800, 9600];

  bios(m: Machine) {
    const ah = m.get8('ah'), al = m.get8('al');
    if (ah === 0) {                                        // init: AL = baud<<5 | parity<<3 | stop<<2 | len
      const div = Math.floor(115200 / Uart.BIOS_BAUDS[al >> 5]);
      this.lcr = 0x80;
      this.writeReg(0, div & 0xFF);
      this.writeReg(1, div >> 8);
      this.writeReg(3, al & 0x1F);
      this.writeReg(4, 0x03);
    } else if (ah === 1) {
      this.writeReg(0, al);
      m.set8('ah', this.readReg(5));
      m.set8('al', al);
      return;
    } else if (ah === 2) {
      this.poll();
      if (this.rx.length) {
        m.set8('al', this.readReg(0));
        m.set8('ah', this.readReg(5) & 0x1E);
      } else m.set8('ah', 0x80);
      return;
    }
    m.set8('ah', this.readReg(5));
    m.set8('al', this.msr());
  }

  poll() {
    const data = this.backend.read();
    if (data.length) {
      this.rx.push(...data);
      if (this.ier & 1) this.m.raiseIrq(this.irqInt);
    }
  }
}
