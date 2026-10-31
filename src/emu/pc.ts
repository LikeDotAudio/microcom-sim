// The whole emulated PC: CPU + BIOS + DOS + COM1/COM2 + LPT1, and one step of the host loop
// (the body of mcomtui/__main__.py's main loop). Used by the page and by the node tests.
import { Bios, VRAM } from './bios';
import { Dos } from './dos';
import { Drive } from './drive';
import { type Clock, Exit, Machine, realClock } from './machine';
import { type Backend, nullBackend, TrafficLog, Uart } from './uart';
import { CP437 } from '../mc3/core/cp437';

export interface PcOptions {
  drive: Drive;
  exe: Uint8Array;
  args?: string;
  clock?: Clock;
  com1?: Backend;
  com2?: Backend;
  log?: (msg: string) => void;
  serialLog?: (line: string) => void;
  printer?: (data: Uint8Array) => void;
  shell?: () => void;
}

export class Pc {
  readonly m: Machine;
  readonly bios: Bios;
  readonly dos: Dos;
  readonly uarts: Uart[];
  readonly traffic: TrafficLog;
  exitCode: number | null = null;

  constructor(o: PcOptions) {
    const clock = o.clock ?? realClock;
    const log = o.log ?? (() => {});
    this.m = new Machine(log, clock);
    const printer = { write: o.printer ?? (() => {}) };
    o.drive.cwd = 'MICROCOM';
    this.dos = new Dos(this.m, o.drive, log, printer, o.shell ?? (() => {}));
    this.bios = new Bios(this.m, log, printer);
    this.traffic = new TrafficLog(clock, o.serialLog ?? (() => {}));
    this.uarts = [
      new Uart(this.m, 0x3F8, 0x0C, o.com1 ?? nullBackend(), this.traffic, 'COM1'),
      new Uart(this.m, 0x2F8, 0x0B, o.com2 ?? nullBackend(), this.traffic, 'COM2'),
    ];
    this.m.intHandlers.set(0x14, mm => {
      if (mm.dx < this.uarts.length) this.uarts[mm.dx].bios(mm);
      else mm.set({ ax: 0x8000 });
    });
    this.m.loadMz(o.exe, 'C:\\MICROCOM\\MCOM.EXE', o.args ?? '',
      { COMSPEC: 'C:\\COMMAND.COM', PATH: 'C:\\;C:\\MICROCOM', PROMPT: '$p$g' });
  }

  /** One host-loop iteration: run a slice, deliver timer ticks, poll the serial ports.
   *  Returns false once the program has exited. */
  step(count = 200_000): boolean {
    if (this.exitCode !== null) return false;
    try {
      this.m.runSlice(count);
    } catch (e) {
      if (e instanceof Exit) { this.exitCode = e.code; this.traffic.flush(); return false; }
      throw e;
    }
    for (let i = 0; i < Math.min(this.bios.tick(), 1); i++) {
      for (const n of [0x08, 0x1C]) {
        if (this.m.programOwns(n)) { this.m.raiseIrq(n); break; }
      }
    }
    for (const u of this.uarts) u.poll();
    return true;
  }

  /** True when the program is idle waiting for a key (the host may sleep). */
  get waiting() { return this.m.waitRequested; }

  vram(): Uint8Array { return this.m.read(VRAM, 4000); }

  screenText(): string {
    const v = this.vram();
    const rows: string[] = [];
    for (let r = 0; r < 25; r++) {
      let s = '';
      for (let c = 0; c < 80; c++) s += CP437[v[(r * 80 + c) * 2]];
      rows.push(s.trimEnd());
    }
    return rows.join('\n');
  }
}
