// Real-mode PC around the CPU: MZ loader, interrupt and port dispatch, IRQs (port of mcomtui/machine.py).
import { AX, BP, BX, CS, CX, Cpu, DI, DS, DX, ES, IF, SI, SP, SS } from './cpu';

export const BIOS_SEG = 0xF000;     // default vectors point at F000:n*4 (an IRET each)
export const PSP_SEG = 0x0FF0;      // so the program loads at 1000:0000, matching the Ghidra addresses
export const ENV_SEG = 0x0F00;
export const TOP_SEG = 0xA000;

/** Host clock: monotonic seconds and local wall time (both injectable so tests can freeze time). */
export interface Clock {
  now(): number;
  wall(): Date;
  sleep?(secs: number): void;
}

export const realClock: Clock = {
  now: () => performance.now() / 1000,
  wall: () => new Date(),
};

export class Exit extends Error {
  constructor(readonly code: number) { super(`program exited with code ${code}`); }
}

type Handler = (m: Machine) => void;
const REG16 = { ax: AX, bx: BX, cx: CX, dx: DX, si: SI, di: DI, bp: BP, sp: SP } as const;
const SEG = { cs: CS, ds: DS, es: ES, ss: SS } as const;
export type Reg = keyof typeof REG16 | keyof typeof SEG | 'ip' | 'flags';
export type Reg8 = 'al' | 'ah' | 'bl' | 'bh' | 'cl' | 'ch' | 'dl' | 'dh';
const R8: Record<Reg8, number> = { al: 0, cl: 1, dl: 2, bl: 3, ah: 4, ch: 5, dh: 6, bh: 7 };

export class Machine {
  readonly cpu = new Cpu();
  readonly intHandlers = new Map<number, Handler>();
  readonly portIn = new Map<number, () => number>();
  readonly portOut = new Map<number, (v: number) => void>();
  pendingIrqs: number[] = [];
  waitRequested = false;
  exitCode: number | null = null;

  constructor(readonly log: (msg: string) => void, readonly clock: Clock = realClock) {
    const c = this.cpu;
    for (let n = 0; n < 256; n++) {
      c.mem[BIOS_SEG * 16 + n * 4] = 0xCF;         // IRET
      this.w16(n * 4, n * 4);
      this.w16(n * 4 + 2, BIOS_SEG);
    }
    c.onInt = n => this.onIntr(n);
    c.portIn = (port, size) => {
      const fn = this.portIn.get(port);
      const v = fn ? fn() : 0xFF;
      return size === 1 ? v & 0xFF : fn ? (v | 0xFF00) & 0xFFFF : 0xFFFF;
    };
    c.portOut = (port, size, value) => {
      const fn = this.portOut.get(port);
      if (fn) {
        fn(value & 0xFF);
        const hi = this.portOut.get(port + 1);
        if (size === 2 && hi) hi((value >> 8) & 0xFF);
      }
    };
  }

  // ---- registers / memory ----------------------------------------------------------------
  get(reg: Reg): number {
    const c = this.cpu;
    if (reg === 'ip') return c.ip;
    if (reg === 'flags') return c.flags;
    if (reg in REG16) return c.r[REG16[reg as keyof typeof REG16]];
    return c.s[SEG[reg as keyof typeof SEG]];
  }
  get ax() { return this.cpu.r[AX]; } get bx() { return this.cpu.r[BX]; }
  get cx() { return this.cpu.r[CX]; } get dx() { return this.cpu.r[DX]; }
  get si() { return this.cpu.r[SI]; } get di() { return this.cpu.r[DI]; }
  get sp() { return this.cpu.r[SP]; } get bp() { return this.cpu.r[BP]; }
  get cs() { return this.cpu.s[CS]; } get ds() { return this.cpu.s[DS]; }
  get es() { return this.cpu.s[ES]; } get ss() { return this.cpu.s[SS]; }
  get ip() { return this.cpu.ip; } get flags() { return this.cpu.flags; }

  set(regs: Partial<Record<Reg, number>>) {
    const c = this.cpu;
    for (const [k, v0] of Object.entries(regs) as [Reg, number][]) {
      const v = v0 & 0xFFFF;
      if (k === 'ip') c.ip = v;
      else if (k === 'flags') c.flags = v;
      else if (k in REG16) c.r[REG16[k as keyof typeof REG16]] = v;
      else c.s[SEG[k as keyof typeof SEG]] = v;
    }
  }
  get8(reg: Reg8): number { return this.cpu.get8(R8[reg]); }
  set8(reg: Reg8, v: number) { this.cpu.set8(R8[reg], v); }
  setFlag(mask: number, on: boolean) { this.cpu.setFlag(mask, on); }

  r8(a: number) { return this.cpu.r8(a); }
  r16(a: number) { return this.cpu.r16(a); }
  w8(a: number, v: number) { this.cpu.w8(a, v); }
  w16(a: number, v: number) { this.cpu.w16(a, v); }
  read(a: number, n: number): Uint8Array { return this.cpu.mem.slice(a, a + n); }
  write(a: number, data: ArrayLike<number>) { this.cpu.mem.set(data, a); }
  asciiz(seg: number, off: number, limit = 256): Uint8Array {
    const d = this.read(seg * 16 + off, limit);
    const z = d.indexOf(0);
    return z < 0 ? d : d.slice(0, z);
  }
  push(v: number) { this.cpu.push(v); }

  // ---- loading -------------------------------------------------------------------------------
  loadMz(data: Uint8Array, dosPath: string, args: string, env: Record<string, string>): number {
    const sig = String.fromCharCode(data[0], data[1]);
    if (sig !== 'MZ' && sig !== 'ZM') throw new Error('not an MZ executable');
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const h = (i: number) => dv.getUint16(2 + i * 2, true);
    const [cblp, cp, nreloc, hdrPar, minalloc, , ss, sp, , ip, cs, relocOff] = Array.from({ length: 12 }, (_, i) => h(i));
    const size = (cp - 1) * 512 + (cblp || 512);
    const image = data.subarray(hdrPar * 16, size);
    const loadSeg = PSP_SEG + 0x10;
    this.write(loadSeg * 16, image);
    for (let i = 0; i < nreloc; i++) {
      const off = dv.getUint16(relocOff + i * 4, true), seg = dv.getUint16(relocOff + i * 4 + 2, true);
      const a = (loadSeg + seg) * 16 + off;
      this.w16(a, this.r16(a) + loadSeg);
    }
    const enc = (s: string) => Array.from(s, ch => ch.charCodeAt(0) & 0xFF);
    const blob: number[] = [];
    for (const [k, v] of Object.entries(env)) blob.push(...enc(`${k}=${v}`), 0);
    blob.push(0, 1, 0, ...enc(dosPath), 0);
    this.write(ENV_SEG * 16, blob);
    const p = PSP_SEG * 16;
    this.write(p, [0xCD, 0x20]);
    this.w16(p + 2, TOP_SEG);
    this.write(p + 0x18, [1, 1, 1, 0, 2, ...new Array(15).fill(0xFF)]);
    this.w16(p + 0x2C, ENV_SEG);
    this.write(p + 0x50, [0xCD, 0x21, 0xCB]);
    const tail = enc(args ? ' ' + args : '').slice(0, 126);
    this.w8(p + 0x80, tail.length);
    this.write(p + 0x81, [...tail, 0x0D]);
    const endSeg = loadSeg + Math.floor((image.length + 15) / 16) + minalloc;
    this.set({ cs: loadSeg + cs, ip, ss: loadSeg + ss, sp, ds: PSP_SEG, es: PSP_SEG,
      ax: 0, bx: 0, cx: 0, dx: 0, si: 0, di: 0, bp: 0, flags: 0x0202 });
    this.log(`loaded image ${image.length} bytes at ${hex(loadSeg)}:0000, entry ${hex(loadSeg + cs)}:${hex(ip)}, ${nreloc} relocs`);
    return endSeg;
  }

  // ---- interrupts ------------------------------------------------------------------------------
  vector(n: number): [number, number] { return [this.r16(n * 4 + 2), this.r16(n * 4)]; }

  programOwns(n: number): boolean {
    const [seg, off] = this.vector(n);
    return !(seg === BIOS_SEG && off === n * 4);
  }

  /** What the CPU does for INT n: push FLAGS/CS/IP, clear IF/TF, jump. */
  enterVector(n: number) {
    const [seg, off] = this.vector(n);
    this.push(this.flags);
    this.push(this.cs);
    this.push(this.ip);
    this.set({ flags: this.flags & ~0x0300, cs: seg, ip: off });
  }

  private onIntr(n: number) {
    try {
      const h = this.intHandlers.get(n);
      if (h && !(n >= 0x20 && this.programOwns(n) && ![0x21, 0x2F, 0x67, 0x33].includes(n))) h(this);
      else if (this.programOwns(n)) this.enterVector(n);
      else if (![0x1B, 0x23, 0x24, 0x28, 0x1C, 0x08].includes(n))
        this.log(`unhandled INT ${hex(n, 2)} AX=${hex(this.ax)} at ${hex(this.cs)}:${hex(this.ip)}`);
    } catch (e) {
      if (!(e instanceof Exit)) throw e;
      this.exitCode = e.code;
      this.cpu.stopRequested = true;
    }
    if (this.waitRequested) this.cpu.stopRequested = true;
  }

  raiseIrq(n: number) { if (!this.pendingIrqs.includes(n)) this.pendingIrqs.push(n); }

  deliverIrqs() {
    if (this.pendingIrqs.length && this.flags & IF) {
      const n = this.pendingIrqs.shift()!;
      if (this.programOwns(n)) this.enterVector(n);
    }
  }

  runSlice(count = 200_000): number {
    this.waitRequested = false;
    this.deliverIrqs();
    const n = this.cpu.run(count);
    if (this.exitCode !== null) throw new Exit(this.exitCode);
    return n;
  }
}

export const hex = (v: number, w = 4) => v.toString(16).padStart(w, '0');
