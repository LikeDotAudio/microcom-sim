// Real-mode x86 interpreter: the 8086 instruction set plus the 186/286 real-mode additions
// (PUSH imm, IMUL imm, shifts by imm, ENTER/LEAVE, PUSHA/POPA, BOUND, INS/OUTS).
//
// It behaves like the Unicorn (QEMU) CPU that mcom-tui uses, so the two can be compared
// instruction by instruction: 386-style details (PUSH SP pushes the old SP, shift counts masked
// to 5 bits, FLAGS bits 12-14 writable and bit 15 clear) and QEMU's choice for flags the Intel
// manual leaves undefined (AF=0 after logic ops, shifts and MUL; DIV leaves flags alone).
//
// Interrupts work like a Unicorn INTR hook: INT n (and CPU exceptions) do not vector by
// themselves; they call onInt(n) with IP after the instruction (at it, for a fault) and the
// host decides whether to service the call itself or enter the program's vector.

export const CF = 0x0001, PF = 0x0004, AF = 0x0010, ZF = 0x0040, SF = 0x0080;
export const TF = 0x0100, IF = 0x0200, DF = 0x0400, OF = 0x0800;
const FLAGS_WRITABLE = 0x7FD5;           // CF PF AF ZF SF TF IF DF OF IOPL NT

// register indices (ModRM order)
export const AX = 0, CX = 1, DX = 2, BX = 3, SP = 4, BP = 5, SI = 6, DI = 7;
export const ES = 0, CS = 1, SS = 2, DS = 3;

export const MEM_SIZE = 0x110000;

const PARITY = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let b = i, p = 1;
  while (b) { p ^= b & 1; b >>= 1; }
  PARITY[i] = p ? PF : 0;
}

export class CpuFault extends Error {}

export class Cpu {
  readonly mem = new Uint8Array(MEM_SIZE + 16);
  readonly r = new Uint16Array(8);
  readonly s = new Uint16Array(4);
  ip = 0;
  flags = 0x0002;
  /** Instructions executed (each REP iteration counts as one, like Unicorn's code hook). */
  icount = 0;
  /** Set by a host callback to end run() after the current instruction (Unicorn's emu_stop). */
  stopRequested = false;

  onInt: (n: number) => void = () => {};
  portIn: (port: number, size: 1 | 2) => number = () => 0xFF;
  portOut: (port: number, size: 1 | 2, value: number) => void = () => {};
  /** Optional: called before each instruction (for traces). */
  onStep: ((cpu: Cpu) => void) | null = null;

  // decode state of the current instruction
  private segOv = -1;
  private rep = 0;               // 0, 0xF2 (REPNE), 0xF3 (REP/REPE)
  private startIp = 0;
  private mod = 0; private reg = 0; private rm = 0;
  private eaSeg = 0; private eaOff = 0;

  // ---- memory ------------------------------------------------------------------------------
  r8(a: number): number { return a < MEM_SIZE ? this.mem[a] : 0; }
  r16(a: number): number { return this.r8(a) | (this.r8(a + 1) << 8); }
  w8(a: number, v: number) { if (a < MEM_SIZE) this.mem[a] = v; }
  w16(a: number, v: number) { this.w8(a, v & 0xFF); this.w8(a + 1, (v >> 8) & 0xFF); }

  get8(i: number): number { return i < 4 ? this.r[i] & 0xFF : this.r[i - 4] >> 8; }
  set8(i: number, v: number) {
    if (i < 4) this.r[i] = (this.r[i] & 0xFF00) | (v & 0xFF);
    else this.r[i - 4] = (this.r[i - 4] & 0x00FF) | ((v & 0xFF) << 8);
  }

  private fetch8(): number {
    const v = this.r8(this.s[CS] * 16 + this.ip);
    this.ip = (this.ip + 1) & 0xFFFF;
    return v;
  }
  private fetch16(): number { const lo = this.fetch8(); return lo | (this.fetch8() << 8); }
  private fetchS8(): number { const v = this.fetch8(); return v & 0x80 ? v - 0x100 : v; }

  push(v: number) {
    this.r[SP] = (this.r[SP] - 2) & 0xFFFF;
    this.w16(this.s[SS] * 16 + this.r[SP], v);
  }
  pop(): number {
    const v = this.r16(this.s[SS] * 16 + this.r[SP]);
    this.r[SP] = (this.r[SP] + 2) & 0xFFFF;
    return v;
  }

  setFlag(mask: number, on: boolean) { this.flags = on ? this.flags | mask : this.flags & ~mask; }
  writeFlags(v: number) { this.flags = (v & FLAGS_WRITABLE) | 0x0002; }

  // ---- ModRM ---------------------------------------------------------------------------------
  private modrm() {
    const b = this.fetch8();
    this.mod = b >> 6; this.reg = (b >> 3) & 7; this.rm = b & 7;
    if (this.mod === 3) return;
    const r = this.r;
    let off = 0, seg = DS;
    switch (this.rm) {
      case 0: off = r[BX] + r[SI]; break;
      case 1: off = r[BX] + r[DI]; break;
      case 2: off = r[BP] + r[SI]; seg = SS; break;
      case 3: off = r[BP] + r[DI]; seg = SS; break;
      case 4: off = r[SI]; break;
      case 5: off = r[DI]; break;
      case 6: if (this.mod === 0) off = this.fetch16(); else { off = r[BP]; seg = SS; } break;
      case 7: off = r[BX]; break;
    }
    if (this.mod === 1) off += this.fetchS8();
    else if (this.mod === 2) off += this.fetch16();
    this.eaOff = off & 0xFFFF;
    this.eaSeg = this.segOv >= 0 ? this.segOv : seg;
  }
  private ea(): number { return this.s[this.eaSeg] * 16 + this.eaOff; }
  private rmRead8(): number { return this.mod === 3 ? this.get8(this.rm) : this.r8(this.ea()); }
  private rmRead16(): number { return this.mod === 3 ? this.r[this.rm] : this.r16(this.ea()); }
  private rmWrite8(v: number) { if (this.mod === 3) this.set8(this.rm, v); else this.w8(this.ea(), v); }
  private rmWrite16(v: number) { if (this.mod === 3) this.r[this.rm] = v; else this.w16(this.ea(), v); }
  private rmRead(w: boolean) { return w ? this.rmRead16() : this.rmRead8(); }
  private rmWrite(w: boolean, v: number) { if (w) this.rmWrite16(v); else this.rmWrite8(v); }
  private regRead(w: boolean) { return w ? this.r[this.reg] : this.get8(this.reg); }
  private regWrite(w: boolean, v: number) { if (w) this.r[this.reg] = v & 0xFFFF; else this.set8(this.reg, v); }
  private dataSeg(): number { return this.s[this.segOv >= 0 ? this.segOv : DS]; }

  // ---- flags / ALU -----------------------------------------------------------------------------
  private szp(res: number, bits: number): number {
    const mask = bits === 8 ? 0xFF : 0xFFFF;
    res &= mask;
    return (res === 0 ? ZF : 0) | (res & (bits === 8 ? 0x80 : 0x8000) ? SF : 0) | PARITY[res & 0xFF];
  }
  private setArith(f: number) { this.flags = (this.flags & ~(CF | PF | AF | ZF | SF | OF)) | f; }

  private add(a: number, b: number, c: number, bits: number): number {
    const mask = bits === 8 ? 0xFF : 0xFFFF, sign = bits === 8 ? 0x80 : 0x8000;
    const res = a + b + c;
    const r = res & mask;
    this.setArith((res > mask ? CF : 0) | ((a ^ b ^ r) & AF) | this.szp(r, bits) |
      ((a ^ r) & (b ^ r) & sign ? OF : 0));
    return r;
  }
  private sub(a: number, b: number, c: number, bits: number): number {
    const mask = bits === 8 ? 0xFF : 0xFFFF, sign = bits === 8 ? 0x80 : 0x8000;
    const res = a - b - c;
    const r = res & mask;
    this.setArith((res < 0 ? CF : 0) | ((a ^ b ^ r) & AF) | this.szp(r, bits) |
      ((a ^ b) & (a ^ r) & sign ? OF : 0));
    return r;
  }
  private logic(r: number, bits: number): number {
    this.setArith(this.szp(r, bits));
    return r & (bits === 8 ? 0xFF : 0xFFFF);
  }
  private alu(op: number, a: number, b: number, bits: number): number {
    switch (op) {
      case 0: return this.add(a, b, 0, bits);
      case 1: return this.logic(a | b, bits);
      case 2: return this.add(a, b, this.flags & CF, bits);
      case 3: return this.sub(a, b, this.flags & CF, bits);
      case 4: return this.logic(a & b, bits);
      case 5: return this.sub(a, b, 0, bits);
      case 6: return this.logic(a ^ b, bits);
      default: this.sub(a, b, 0, bits); return a;      // CMP
    }
  }
  private inc(a: number, bits: number, d: number): number {
    const cf = this.flags & CF;
    const r = d > 0 ? this.add(a, 1, 0, bits) : this.sub(a, 1, 0, bits);
    this.flags = (this.flags & ~CF) | cf;
    return r;
  }

  /** Shift/rotate group (C0/C1/D0-D3): op = ModRM reg field. */
  private shift(op: number, v: number, count: number, bits: number): number {
    count &= 0x1F;
    if (count === 0) return v;
    const mask = bits === 8 ? 0xFF : 0xFFFF, top = bits - 1;
    const msb = (x: number) => (x >> top) & 1;
    let r = v, cf: number, of: number;
    switch (op) {
      case 0: case 1: {                                   // ROL, ROR
        const n = count % bits;
        r = n === 0 ? v : (op === 0 ? ((v << n) | (v >> (bits - n))) : ((v >> n) | (v << (bits - n)))) & mask;
        if (op === 0) { cf = r & 1; of = cf ^ msb(r); }
        else { cf = msb(r); of = msb(r) ^ ((r >> (top - 1)) & 1); }
        this.flags = (this.flags & ~(CF | OF)) | (cf ? CF : 0) | (of ? OF : 0);
        return r;
      }
      case 2: case 3: {                                   // RCL, RCR
        const n = count % (bits + 1);
        if (n === 0) return v;
        let c = this.flags & CF;
        for (let i = 0; i < n; i++) {
          if (op === 2) { const out = msb(r); r = ((r << 1) | c) & mask; c = out; }
          else { const out = r & 1; r = (r >> 1) | (c << top); c = out; }
        }
        of = msb(v ^ r);
        this.flags = (this.flags & ~(CF | OF)) | (c ? CF : 0) | (of ? OF : 0);
        return r;
      }
      case 4: case 6: {                                   // SHL/SAL
        const src = count - 1 < bits ? (v << (count - 1)) & mask : 0;
        r = (src << 1) & mask;
        cf = msb(src);
        of = msb(src ^ r);
        break;
      }
      case 5: {                                           // SHR
        const src = count - 1 < 32 ? v >>> (count - 1) : 0;
        r = (src >> 1) & mask;
        cf = src & 1;
        of = msb((src & mask) ^ r);
        break;
      }
      default: {                                          // SAR
        const sv = v & (1 << top) ? v - (1 << bits) : v;
        const src = sv >> Math.min(count - 1, 31);
        r = (src >> 1) & mask;
        cf = src & 1;
        of = msb((src & mask) ^ r);
      }
    }
    this.setArith((cf ? CF : 0) | (of ? OF : 0) | this.szp(r, bits));
    return r;
  }

  private mulFlags(low: number, carry: boolean, bits: number) {
    this.setArith(this.szp(low, bits) | (carry ? CF | OF : 0));
  }

  private cond(c: number): boolean {
    const f = this.flags;
    let v: boolean;
    switch (c >> 1) {
      case 0: v = !!(f & OF); break;
      case 1: v = !!(f & CF); break;
      case 2: v = !!(f & ZF); break;
      case 3: v = !!(f & (CF | ZF)); break;
      case 4: v = !!(f & SF); break;
      case 5: v = !!(f & PF); break;
      case 6: v = !(f & SF) !== !(f & OF); break;
      default: v = (!(f & SF) !== !(f & OF)) || !!(f & ZF);
    }
    return c & 1 ? !v : v;
  }

  private fault(n: number) {
    this.ip = this.startIp;
    this.onInt(n);
  }

  // ---- string instructions ----------------------------------------------------------------------
  /** One iteration (or the whole instruction without REP). Returns after re-pointing IP for REP. */
  private string(op: number) {
    const w = (op & 1) === 1, size = w ? 2 : 1;
    const r = this.r;
    if (this.rep && r[CX] === 0) return;
    const d = this.flags & DF ? -size : size;
    const src = () => this.dataSeg() * 16 + r[SI];
    const dst = () => this.s[ES] * 16 + r[DI];
    let cmp = false;
    switch (op & 0xFE) {
      case 0xA4: { const v = w ? this.r16(src()) : this.r8(src()); if (w) this.w16(dst(), v); else this.w8(dst(), v);
        r[SI] += d; r[DI] += d; break; }
      case 0xA6: { const a = w ? this.r16(src()) : this.r8(src()); const b = w ? this.r16(dst()) : this.r8(dst());
        this.sub(a, b, 0, w ? 16 : 8); r[SI] += d; r[DI] += d; cmp = true; break; }
      case 0xAA: if (w) this.w16(dst(), r[AX]); else this.w8(dst(), r[AX] & 0xFF); r[DI] += d; break;
      case 0xAC: if (w) r[AX] = this.r16(src()); else this.set8(0, this.r8(src())); r[SI] += d; break;
      case 0xAE: { const b = w ? this.r16(dst()) : this.r8(dst()); this.sub(w ? r[AX] : r[AX] & 0xFF, b, 0, w ? 16 : 8);
        r[DI] += d; cmp = true; break; }
      case 0x6C: { const v = this.portIn(r[DX], w ? 2 : 1); if (w) this.w16(dst(), v); else this.w8(dst(), v); r[DI] += d; break; }
      case 0x6E: { const v = w ? this.r16(src()) : this.r8(src()); this.portOut(r[DX], w ? 2 : 1, v); r[SI] += d; break; }
    }
    if (!this.rep) return;
    r[CX]--;
    if (cmp && ((this.rep === 0xF3) !== !!(this.flags & ZF))) return;
    // QEMU runs each iteration as a new instruction and tests CX = 0 only on entry, so the
    // last iteration is followed by one more (empty) execution, as Unicorn's code hook shows
    this.ip = this.startIp;
  }

  // ---- execution ------------------------------------------------------------------------------------
  /** Execute up to `count` instructions; stops early when a callback sets stopRequested. */
  run(count: number): number {
    this.stopRequested = false;
    const start = this.icount;
    const end = start + count;
    while (this.icount < end) {
      if (this.onStep) this.onStep(this);
      this.icount++;
      this.step();
      if (this.stopRequested) break;
    }
    return this.icount - start;
  }

  step() {
    const r = this.r, s = this.s;
    this.startIp = this.ip;
    this.segOv = -1;
    this.rep = 0;
    let op: number;
    for (;;) {
      op = this.fetch8();
      if (op === 0x26 || op === 0x2E || op === 0x36 || op === 0x3E) this.segOv = (op >> 3) & 3;
      else if (op === 0xF2 || op === 0xF3) this.rep = op;
      else if (op !== 0xF0) break;
    }

    if (op < 0x40 && (op & 7) < 6) {                    // ALU group
      const aop = op >> 3, w = (op & 1) === 1, bits = w ? 16 : 8;
      switch (op & 7) {
        case 0: case 1: { this.modrm(); const v = this.alu(aop, this.rmRead(w), this.regRead(w), bits); if (aop !== 7) this.rmWrite(w, v); return; }
        case 2: case 3: { this.modrm(); const v = this.alu(aop, this.regRead(w), this.rmRead(w), bits); if (aop !== 7) this.regWrite(w, v); return; }
        case 4: { const v = this.alu(aop, r[AX] & 0xFF, this.fetch8(), 8); if (aop !== 7) this.set8(0, v); return; }
        case 5: { const v = this.alu(aop, r[AX], this.fetch16(), 16); if (aop !== 7) r[AX] = v; return; }
      }
    }

    switch (op) {
      case 0x06: case 0x0E: case 0x16: case 0x1E: this.push(s[op >> 3]); return;
      case 0x07: case 0x17: case 0x1F: s[op >> 3] = this.pop(); return;
      case 0x27: case 0x2F: this.daa(op === 0x2F); return;
      case 0x37: case 0x3F: this.aaa(op === 0x3F); return;
    }
    if (op >= 0x40 && op < 0x50) { const i = op & 7; r[i] = this.inc(r[i], 16, op < 0x48 ? 1 : -1); return; }
    if (op >= 0x50 && op < 0x58) { this.push(op === 0x54 ? r[SP] : r[op & 7]); return; }
    if (op >= 0x58 && op < 0x60) { const v = this.pop(); r[op & 7] = v; return; }
    if (op >= 0x70 && op < 0x80) { const d = this.fetchS8(); if (this.cond(op & 15)) this.ip = (this.ip + d) & 0xFFFF; return; }
    if (op >= 0x91 && op < 0x98) { const i = op & 7, t = r[AX]; r[AX] = r[i]; r[i] = t; return; }
    if (op >= 0xB0 && op < 0xB8) { this.set8(op & 7, this.fetch8()); return; }
    if (op >= 0xB8 && op < 0xC0) { r[op & 7] = this.fetch16(); return; }
    if (op >= 0xD8 && op < 0xE0) throw new CpuFault(`x87 instruction ${op.toString(16)} at ${this.where()}`);

    switch (op) {
      case 0x60: { const sp = r[SP]; for (const i of [AX, CX, DX, BX]) this.push(r[i]); this.push(sp);
        for (const i of [BP, SI, DI]) this.push(r[i]); return; }
      case 0x61: { for (const i of [DI, SI, BP]) r[i] = this.pop(); this.pop(); for (const i of [BX, DX, CX, AX]) r[i] = this.pop(); return; }
      case 0x62: { this.modrm(); const a = this.ea(); const v = this.r[this.reg] << 16 >> 16;
        const lo = this.r16(a) << 16 >> 16, hi = this.r16(a + 2) << 16 >> 16;
        if (v < lo || v > hi) this.fault(5); return; }
      case 0x68: this.push(this.fetch16()); return;
      case 0x6A: this.push(this.fetchS8() & 0xFFFF); return;
      case 0x69: case 0x6B: {
        this.modrm();
        const a = this.rmRead16() << 16 >> 16;
        const b = op === 0x69 ? this.fetch16() << 16 >> 16 : this.fetchS8();
        const p = a * b, low = p & 0xFFFF;
        this.regWrite(true, low);
        this.mulFlags(low, p !== (low << 16 >> 16), 16);
        return;
      }
      case 0x6C: case 0x6D: case 0x6E: case 0x6F: this.string(op); return;
      case 0x80: case 0x81: case 0x82: case 0x83: {
        const w = (op & 1) === 1;
        this.modrm();
        const a = this.rmRead(w);
        const b = op === 0x81 ? this.fetch16() : op === 0x83 ? this.fetchS8() & 0xFFFF : this.fetch8();
        const v = this.alu(this.reg, a, b, w ? 16 : 8);
        if (this.reg !== 7) this.rmWrite(w, v);
        return;
      }
      case 0x84: case 0x85: { const w = op === 0x85; this.modrm(); this.logic(this.rmRead(w) & this.regRead(w), w ? 16 : 8); return; }
      case 0x86: case 0x87: { const w = op === 0x87; this.modrm(); const a = this.rmRead(w), b = this.regRead(w);
        this.rmWrite(w, b); this.regWrite(w, a); return; }
      case 0x88: case 0x89: { const w = op === 0x89; this.modrm(); this.rmWrite(w, this.regRead(w)); return; }
      case 0x8A: case 0x8B: { const w = op === 0x8B; this.modrm(); this.regWrite(w, this.rmRead(w)); return; }
      case 0x8C: this.modrm(); this.rmWrite16(s[this.reg & 3]); return;
      case 0x8D: this.modrm(); r[this.reg] = this.eaOff; return;
      case 0x8E: this.modrm(); s[this.reg & 3] = this.rmRead16(); return;
      case 0x8F: { const v = this.pop(); this.modrm(); this.rmWrite16(v); return; }
      case 0x90: return;
      case 0x98: r[AX] = (r[AX] & 0x80) ? r[AX] | 0xFF00 : r[AX] & 0xFF; return;
      case 0x99: r[DX] = r[AX] & 0x8000 ? 0xFFFF : 0; return;
      case 0x9A: { const ip = this.fetch16(), cs = this.fetch16(); this.push(s[CS]); this.push(this.ip); s[CS] = cs; this.ip = ip; return; }
      case 0x9B: return;
      case 0x9C: this.push(this.flags); return;
      case 0x9D: this.writeFlags(this.pop()); return;
      case 0x9E: this.flags = (this.flags & 0xFF00) | ((r[AX] >> 8) & (SF | ZF | AF | PF | CF)) | 2; return;
      case 0x9F: this.set8(4, (this.flags & 0xD5) | 2); return;
      case 0xA0: this.set8(0, this.r8(this.dataSeg() * 16 + this.fetch16())); return;
      case 0xA1: r[AX] = this.r16(this.dataSeg() * 16 + this.fetch16()); return;
      case 0xA2: this.w8(this.dataSeg() * 16 + this.fetch16(), r[AX]); return;
      case 0xA3: this.w16(this.dataSeg() * 16 + this.fetch16(), r[AX]); return;
      case 0xA4: case 0xA5: case 0xA6: case 0xA7: case 0xAA: case 0xAB: case 0xAC: case 0xAD: case 0xAE: case 0xAF:
        this.string(op); return;
      case 0xA8: this.logic((r[AX] & 0xFF) & this.fetch8(), 8); return;
      case 0xA9: this.logic(r[AX] & this.fetch16(), 16); return;
      case 0xC0: case 0xC1: case 0xD0: case 0xD1: case 0xD2: case 0xD3: {
        const w = (op & 1) === 1;
        this.modrm();
        const v = this.rmRead(w);
        const n = op <= 0xC1 ? this.fetch8() : op <= 0xD1 ? 1 : r[CX] & 0xFF;
        this.rmWrite(w, this.shift(this.reg, v, n, w ? 16 : 8));
        return;
      }
      case 0xC2: { const n = this.fetch16(); this.ip = this.pop(); r[SP] += n; return; }
      case 0xC3: this.ip = this.pop(); return;
      case 0xC4: case 0xC5: { this.modrm(); const a = this.ea(); r[this.reg] = this.r16(a); s[op === 0xC4 ? ES : DS] = this.r16(a + 2); return; }
      case 0xC6: this.modrm(); this.rmWrite8(this.fetch8()); return;
      case 0xC7: this.modrm(); this.rmWrite16(this.fetch16()); return;
      case 0xC8: {
        const size = this.fetch16(), level = this.fetch8() & 31;
        this.push(r[BP]);
        const frame = r[SP];
        for (let i = 1; i < level; i++) { r[BP] -= 2; this.push(this.r16(s[SS] * 16 + r[BP])); }
        if (level > 0) this.push(frame);
        r[BP] = frame;
        r[SP] -= size;
        return;
      }
      case 0xC9: r[SP] = r[BP]; r[BP] = this.pop(); return;
      case 0xCA: { const n = this.fetch16(); this.ip = this.pop(); s[CS] = this.pop(); r[SP] += n; return; }
      case 0xCB: this.ip = this.pop(); s[CS] = this.pop(); return;
      case 0xCC: this.onInt(3); return;
      case 0xCD: this.onInt(this.fetch8()); return;
      case 0xCE: if (this.flags & OF) this.onInt(4); return;
      case 0xCF: this.ip = this.pop(); s[CS] = this.pop(); this.writeFlags(this.pop()); return;
      case 0xD4: { const base = this.fetch8(); if (base === 0) { this.fault(0); return; }
        const al = r[AX] & 0xFF; r[AX] = ((Math.floor(al / base)) << 8) | (al % base); this.logic(r[AX] & 0xFF, 8); return; }
      case 0xD5: { const base = this.fetch8(); const al = ((r[AX] >> 8) * base + (r[AX] & 0xFF)) & 0xFF;
        r[AX] = al; this.logic(al, 8); return; }
      case 0xD6: this.set8(0, this.flags & CF ? 0xFF : 0); return;
      case 0xD7: this.set8(0, this.r8(this.dataSeg() * 16 + ((r[BX] + (r[AX] & 0xFF)) & 0xFFFF))); return;
      case 0xE0: case 0xE1: case 0xE2: {
        const d = this.fetchS8();
        r[CX]--;
        const z = !!(this.flags & ZF);
        if (r[CX] !== 0 && (op === 0xE2 || (op === 0xE1 ? z : !z))) this.ip = (this.ip + d) & 0xFFFF;
        return;
      }
      case 0xE3: { const d = this.fetchS8(); if (r[CX] === 0) this.ip = (this.ip + d) & 0xFFFF; return; }
      case 0xE4: this.set8(0, this.portIn(this.fetch8(), 1)); return;
      case 0xE5: r[AX] = this.portIn(this.fetch8(), 2); return;
      case 0xE6: this.portOut(this.fetch8(), 1, r[AX] & 0xFF); return;
      case 0xE7: this.portOut(this.fetch8(), 2, r[AX]); return;
      case 0xE8: { const d = this.fetch16(); this.push(this.ip); this.ip = (this.ip + d) & 0xFFFF; return; }
      case 0xE9: { const d = this.fetch16(); this.ip = (this.ip + d) & 0xFFFF; return; }
      case 0xEA: { const ip = this.fetch16(), cs = this.fetch16(); s[CS] = cs; this.ip = ip; return; }
      case 0xEB: { const d = this.fetchS8(); this.ip = (this.ip + d) & 0xFFFF; return; }
      case 0xEC: this.set8(0, this.portIn(r[DX], 1)); return;
      case 0xED: r[AX] = this.portIn(r[DX], 2); return;
      case 0xEE: this.portOut(r[DX], 1, r[AX] & 0xFF); return;
      case 0xEF: this.portOut(r[DX], 2, r[AX]); return;
      case 0xF4: this.stopRequested = true; return;
      case 0xF5: this.flags ^= CF; return;
      case 0xF6: case 0xF7: this.grp3(op === 0xF7); return;
      case 0xF8: this.flags &= ~CF; return;
      case 0xF9: this.flags |= CF; return;
      case 0xFA: this.flags &= ~IF; return;
      case 0xFB: this.flags |= IF; return;
      case 0xFC: this.flags &= ~DF; return;
      case 0xFD: this.flags |= DF; return;
      case 0xFE: {
        this.modrm();
        if (this.reg > 1) throw new CpuFault(`bad FE /${this.reg} at ${this.where()}`);
        this.rmWrite8(this.inc(this.rmRead8(), 8, this.reg === 0 ? 1 : -1));
        return;
      }
      case 0xFF: this.grp5(); return;
    }
    throw new CpuFault(`unimplemented opcode ${op.toString(16).padStart(2, '0')} at ${this.where()}`);
  }

  private grp3(w: boolean) {
    const r = this.r;
    this.modrm();
    const bits = w ? 16 : 8;
    switch (this.reg) {
      case 0: case 1: { const v = this.rmRead(w); this.logic(v & (w ? this.fetch16() : this.fetch8()), bits); return; }
      case 2: this.rmWrite(w, ~this.rmRead(w) & (w ? 0xFFFF : 0xFF)); return;
      case 3: this.rmWrite(w, this.sub(0, this.rmRead(w), 0, bits)); return;
      case 4: {
        const v = this.rmRead(w);
        if (w) { const p = r[AX] * v; r[AX] = p & 0xFFFF; r[DX] = Math.floor(p / 0x10000); this.mulFlags(r[AX], r[DX] !== 0, 16); }
        else { const p = (r[AX] & 0xFF) * v; r[AX] = p; this.mulFlags(p & 0xFF, (p & 0xFF00) !== 0, 8); }
        return;
      }
      case 5: {
        const v = this.rmRead(w);
        if (w) {
          const p = (r[AX] << 16 >> 16) * (v << 16 >> 16);
          const low = p & 0xFFFF;
          r[AX] = low; r[DX] = (p >> 16) & 0xFFFF;
          this.mulFlags(low, p !== (low << 16 >> 16), 16);
        } else {
          const p = ((r[AX] & 0xFF) << 24 >> 24) * (v << 24 >> 24);
          r[AX] = p & 0xFFFF;
          this.mulFlags(p & 0xFF, p !== ((p & 0xFF) << 24 >> 24), 8);
        }
        return;
      }
      case 6: {
        const v = this.rmRead(w);
        if (v === 0) { this.fault(0); return; }
        if (w) {
          const n = r[DX] * 0x10000 + r[AX];
          const q = Math.floor(n / v);
          if (q > 0xFFFF) { this.fault(0); return; }
          r[DX] = n % v; r[AX] = q;
        } else {
          const n = r[AX], q = Math.floor(n / v);
          if (q > 0xFF) { this.fault(0); return; }
          r[AX] = ((n % v) << 8) | q;
        }
        return;
      }
      default: {
        const v = this.rmRead(w);
        if (v === 0) { this.fault(0); return; }
        if (w) {
          const n = ((r[DX] << 16) | r[AX]) | 0, d = v << 16 >> 16;
          const q = Math.trunc(n / d);
          if (q > 32767 || q < -32768) { this.fault(0); return; }
          r[AX] = q & 0xFFFF; r[DX] = (n - q * d) & 0xFFFF;
        } else {
          const n = r[AX] << 16 >> 16, d = v << 24 >> 24;
          const q = Math.trunc(n / d);
          if (q > 127 || q < -128) { this.fault(0); return; }
          r[AX] = (((n - q * d) & 0xFF) << 8) | (q & 0xFF);
        }
      }
    }
  }

  private grp5() {
    const r = this.r, s = this.s;
    this.modrm();
    switch (this.reg) {
      case 0: this.rmWrite16(this.inc(this.rmRead16(), 16, 1)); return;
      case 1: this.rmWrite16(this.inc(this.rmRead16(), 16, -1)); return;
      case 2: { const t = this.rmRead16(); this.push(this.ip); this.ip = t; return; }
      case 3: { const a = this.ea(); const ip = this.r16(a), cs = this.r16(a + 2);
        this.push(s[CS]); this.push(this.ip); s[CS] = cs; this.ip = ip; return; }
      case 4: this.ip = this.rmRead16(); return;
      case 5: { const a = this.ea(); this.ip = this.r16(a); s[CS] = this.r16(a + 2); return; }
      case 6: { const v = this.rmRead16(); this.push(this.mod === 3 && this.rm === SP ? r[SP] : v); return; }
    }
    throw new CpuFault(`bad FF /7 at ${this.where()}`);
  }

  private daa(sub: boolean) {
    let al = this.r[AX] & 0xFF;
    const oldAl = al, oldCf = this.flags & CF;
    let cf = 0, af = 0;
    if ((al & 0x0F) > 9 || this.flags & AF) { al = sub ? al - 6 : al + 6; af = AF; cf = oldCf | (sub ? (oldAl < 6 ? 1 : 0) : (al > 0xFF ? 1 : 0)); al &= 0xFF; }
    if (oldAl > 0x99 || oldCf) { al = (sub ? al - 0x60 : al + 0x60) & 0xFF; cf = CF; }
    this.set8(0, al);
    this.flags = (this.flags & ~(CF | PF | AF | ZF | SF)) | (cf ? CF : 0) | af | this.szp(al, 8);
  }

  private aaa(sub: boolean) {
    const r = this.r;
    if ((r[AX] & 0x0F) > 9 || this.flags & AF) {
      if (sub) { r[AX] = (r[AX] - 6) & 0xFFFF; r[AX] = (r[AX] & 0x00FF) | ((((r[AX] >> 8) - 1) & 0xFF) << 8); }
      else { r[AX] = (r[AX] + 0x106) & 0xFFFF; }
      this.flags |= AF | CF;
    } else this.flags &= ~(AF | CF);
    this.set8(0, r[AX] & 0x0F);
  }

  where(): string {
    const h = (v: number) => v.toString(16).padStart(4, '0');
    return `${h(this.s[CS])}:${h(this.startIp)}`;
  }
}
