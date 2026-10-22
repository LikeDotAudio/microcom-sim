// BIOS services (INT 10h/11h/12h/15h/16h/17h/1Ah, mouse/EMS stubs) and the BIOS data area
// (port of mcomtui/bios.py).
import { CF, ZF } from './cpu';
import type { Machine } from './machine';

export const VRAM = 0xB8000;
export const BDA = 0x400;
const KBD_START = 0x1E, KBD_END = 0x3E;          // keyboard ring buffer offsets in the BDA

const bcd = (v: number) => (Math.floor(v / 10) << 4) | (v % 10);

export interface Printer { write(data: Uint8Array): void }

export class Bios {
  cursor: [number, number] = [0, 0];             // row, col
  cursorShape: [number, number] = [6, 7];
  cursorHidden = false;
  blink = true;                                  // attribute bit 7 = blink (false: bright background)
  private crtcIndex = 0;
  private readonly crtc = new Uint8Array(32);
  private retrace = 0;
  private readonly ticksStart: number;
  private tas: number | null = null;
  private idlePolls = 0;
  private picMask = 0xB8;

  constructor(readonly m: Machine, readonly log: (s: string) => void, readonly printer: Printer) {
    this.ticksStart = m.clock.now();
    this.initBda();
    const h: [number, (m: Machine) => void][] = [[0x10, x => this.int10(x)], [0x11, x => this.int11(x)],
      [0x12, x => this.int12(x)], [0x16, x => this.int16(x)], [0x17, x => this.int17(x)], [0x1A, x => this.int1a(x)],
      [0x33, x => this.int33(x)], [0x67, x => this.int67(x)], [0x2F, x => this.int2f(x)], [0x15, x => this.int15(x)]];
    for (const [n, fn] of h) m.intHandlers.set(n, fn);
    const pi = m.portIn, po = m.portOut;
    pi.set(0x3DA, () => this.status());
    pi.set(0x3BA, () => this.status());
    po.set(0x3D4, v => { this.crtcIndex = v; });
    po.set(0x3D5, v => this.crtcData(v));
    pi.set(0x3D5, () => this.crtc[this.crtcIndex & 31]);
    po.set(0x3D8, v => { this.blink = !!(v & 0x20); });
    pi.set(0x21, () => this.picMask);
    po.set(0x21, v => { this.picMask = v; });
    po.set(0x20, () => {});
    pi.set(0x20, () => 0);
    pi.set(0x61, () => 0x30);
    po.set(0x61, () => {});
    for (const p of [0x40, 0x41, 0x42, 0x43]) {
      po.set(p, () => {});
      pi.set(p, () => Math.floor(m.clock.now() * 1193182) & 0xFF);
    }
    pi.set(0x379, () => 0xDF);                    // LPT1 status: selected, not busy, no error
    po.set(0x378, v => this.printer.write(Uint8Array.of(v)));
    po.set(0x37A, () => {});
    pi.set(0x37A, () => 0x0C);
  }

  private initBda() {
    const m = this.m;
    m.w16(BDA + 0x00, 0x3F8);
    m.w16(BDA + 0x02, 0x2F8);
    m.w16(BDA + 0x08, 0x378);
    m.w16(BDA + 0x10, 0x4427);                   // equipment: 1 LPT, 2 COM, 80x25 colour, FPU, floppy
    m.w16(BDA + 0x13, 640);
    m.w16(BDA + 0x1A, KBD_START);
    m.w16(BDA + 0x1C, KBD_START);
    m.w16(BDA + 0x80, KBD_START);
    m.w16(BDA + 0x82, KBD_END);
    m.w8(BDA + 0x49, 3);
    m.w16(BDA + 0x4A, 80);
    m.w16(BDA + 0x4C, 4096);
    m.w16(BDA + 0x4E, 0);
    m.w16(BDA + 0x60, 0x0607);
    m.w8(BDA + 0x62, 0);
    m.w16(BDA + 0x63, 0x3D4);
    m.w8(BDA + 0x65, 0x29);
    m.w8(BDA + 0x84, 24);
    m.w16(BDA + 0x85, 16);
    m.w8(BDA + 0x87, 0x60);
    m.w8(BDA + 0x88, 0x09);
    m.w8(BDA + 0x89, 0x11);
    this.clearScreen();
    m.w8(0xFFFFE, 0xFC);                         // BIOS model byte / date so detection code sees an AT
    m.write(0xFFFF5, Array.from('01/01/92', c => c.charCodeAt(0)));
  }

  private clearScreen() {
    for (let i = 0; i < 2000; i++) { this.m.w8(VRAM + i * 2, 0x20); this.m.w8(VRAM + i * 2 + 1, 0x07); }
  }

  // ---- timer ---------------------------------------------------------------------------------
  /** Advance the BIOS tick counter to wall-clock time (18.2 Hz). Returns ticks added. */
  tick(): number {
    const m = this.m;
    const now = Math.floor((m.clock.now() - this.ticksStart) * 1193182 / 65536);
    const old = m.r16(BDA + 0x6C) + m.r16(BDA + 0x6E) * 0x10000;
    const midnight = this.ticksAtStart() + now;
    const added = midnight - old;
    if (added > 0) {
      m.w16(BDA + 0x6C, midnight & 0xFFFF);
      m.w16(BDA + 0x6E, Math.floor(midnight / 0x10000) & 0xFFFF);
    }
    return Math.max(added, 0);
  }

  private ticksAtStart(): number {
    if (this.tas === null) {
      const t = this.m.clock.wall();
      const secs = t.getHours() * 3600 + t.getMinutes() * 60 + t.getSeconds() + t.getMilliseconds() / 1000;
      this.tas = Math.floor(secs * 18.2065) - Math.floor((this.m.clock.now() - this.ticksStart) * 18.2065);
    }
    return this.tas;
  }

  // ---- keyboard --------------------------------------------------------------------------------
  pushKey(code: number, shiftFlags = 0) {
    const m = this.m;
    const head = m.r16(BDA + 0x1A), tail = m.r16(BDA + 0x1C);
    const nxt = tail + 2 < KBD_END ? tail + 2 : KBD_START;
    if (nxt === head) return;
    m.w16(BDA + tail, code);
    m.w16(BDA + 0x1C, nxt);
    m.w8(BDA + 0x17, shiftFlags);
  }

  keysPending(): boolean { return this.m.r16(BDA + 0x1A) !== this.m.r16(BDA + 0x1C); }

  private peekKey(): [number, number] | null {
    const m = this.m;
    const head = m.r16(BDA + 0x1A), tail = m.r16(BDA + 0x1C);
    return head === tail ? null : [head, m.r16(BDA + head)];
  }

  int16(m: Machine) {
    const ah = m.get8('ah');
    if (ah === 0x00 || ah === 0x10) {
      const k = this.peekKey();
      if (!k) {                                  // no key yet: re-execute the INT once the host has input
        m.set({ ip: m.ip - 2 });
        m.waitRequested = true;
        return;
      }
      const [head, code] = k;
      m.w16(BDA + 0x1A, head + 2 < KBD_END ? head + 2 : KBD_START);
      m.set({ ax: code });
      this.idlePolls = 0;
    } else if (ah === 0x01 || ah === 0x11) {
      const k = this.peekKey();
      if (!k) {
        m.setFlag(ZF, true);
        this.idlePolls++;
        if (this.idlePolls > 50) {               // program is spinning on "key pressed?": let host sleep
          this.idlePolls = 0;
          m.waitRequested = true;
        }
      } else {
        m.setFlag(ZF, false);
        m.set({ ax: k[1] });
      }
    } else if (ah === 0x02 || ah === 0x12) {
      m.set8('al', m.r8(BDA + 0x17));
      if (ah === 0x12) m.set8('ah', 0);
    } else if (ah === 0x05) {
      this.pushKey(m.cx);
      m.set8('al', 0);
    } else this.log(`INT 16 AH=${ah.toString(16)} unhandled`);
  }

  // ---- video -------------------------------------------------------------------------------------
  private status(): number {
    this.retrace = (this.retrace + 1) & 0xFF;
    return this.retrace & 2 ? 0x09 : 0x00;
  }

  private crtcData(v: number) {
    const i = this.crtcIndex & 31;
    this.crtc[i] = v;
    if (i === 0x0E || i === 0x0F) {
      const pos = ((this.crtc[0x0E] << 8) | this.crtc[0x0F]) % 2000;
      this.cursor = [Math.floor(pos / 80), pos % 80];
    } else if (i === 0x0A) this.cursorHidden = !!(v & 0x20);
  }

  setCursor(row: number, col: number) {
    this.cursor = [row, col];
    this.m.w8(BDA + 0x50, col);
    this.m.w8(BDA + 0x51, row);
  }

  int10(m: Machine) {
    const ah = m.get8('ah');
    switch (ah) {
      case 0x00: this.clearScreen(); break;
      case 0x01: {
        const ch = m.get8('ch'), cl = m.get8('cl');
        this.cursorHidden = !!(ch & 0x20) || (ch > cl && ch >= 0x10);
        this.cursorShape = [ch, cl];
        m.w16(BDA + 0x60, m.cx);
        break;
      }
      case 0x02: this.setCursor(m.get8('dh'), m.get8('dl')); break;
      case 0x03: { const [row, col] = this.cursor; m.set({ dx: (row << 8) | col, cx: m.r16(BDA + 0x60) }); break; }
      case 0x05: break;
      case 0x06: case 0x07: this.scroll(m, ah === 0x06); break;
      case 0x08: { const [row, col] = this.cursor; m.set({ ax: m.r16(VRAM + (row * 80 + col) * 2) }); break; }
      case 0x09: case 0x0A: {
        const [row, col] = this.cursor;
        const ch = m.get8('al'), attr = m.get8('bl'), n = m.cx;
        const pos = row * 80 + col;
        for (let i = 0; i < Math.min(n, 2000 - pos); i++) {
          m.w8(VRAM + (pos + i) * 2, ch);
          if (ah === 0x09) m.w8(VRAM + (pos + i) * 2 + 1, attr);
        }
        break;
      }
      case 0x0E: this.teletype(m.get8('al')); break;
      case 0x0F: m.set({ ax: 0x5003, bx: m.bx & 0x00FF }); break;
      case 0x10: if (m.get8('al') === 0x03) this.blink = !!m.get8('bl'); break;
      case 0x11: if (m.get8('al') === 0x30) m.set({ cx: 16, dx: 24 }); break;
      case 0x12: if (m.get8('bl') === 0x10) m.set({ bx: 0x0003, cx: 0x0009 }); break;
      case 0x1A: if (m.get8('al') === 0) m.set({ ax: 0x001A, bx: 0x0008 }); break;
      case 0x1B: case 0xFE: case 0xFF: case 0xCD: case 0xCC: break;
      default: this.log(`INT 10 AH=${ah.toString(16)} unhandled`);
    }
  }

  private scroll(m: Machine, up: boolean) {
    let n = m.get8('al');
    const attr = m.get8('bh');
    const r1 = m.get8('ch'), c1 = m.get8('cl');
    const r2 = Math.min(m.get8('dh'), 24), c2 = Math.min(m.get8('dl'), 79);
    const height = r2 - r1 + 1;
    if (n === 0 || n >= height) n = height;
    const rows: number[] = [];
    for (let r = r1; r <= r2; r++) rows.push(r);
    if (!up) rows.reverse();
    rows.forEach((r, i) => {
      const src = up ? r + n : r - n;
      for (let c = c1; c <= c2; c++) {
        const a = VRAM + (r * 80 + c) * 2;
        if (i + n < height) m.write(a, m.read(VRAM + (src * 80 + c) * 2, 2));
        else { m.w8(a, 0x20); m.w8(a + 1, attr); }
      }
    });
  }

  private teletype(ch: number) {
    let [row, col] = this.cursor;
    const m = this.m;
    if (ch === 0x0D) col = 0;
    else if (ch === 0x0A) row++;
    else if (ch === 0x08) col = Math.max(0, col - 1);
    else if (ch !== 0x07) {
      m.w8(VRAM + (row * 80 + col) * 2, ch);
      col++;
      if (col >= 80) { col = 0; row++; }
    }
    if (row >= 25) {
      m.write(VRAM, m.read(VRAM + 160, 160 * 24));
      for (let i = 0; i < 80; i++) { m.w8(VRAM + 160 * 24 + i * 2, 0x20); m.w8(VRAM + 160 * 24 + i * 2 + 1, 0x07); }
      row = 24;
    }
    this.setCursor(row, col);
  }

  // ---- misc ------------------------------------------------------------------------------------------
  int11(m: Machine) { m.set({ ax: m.r16(BDA + 0x10) }); }
  int12(m: Machine) { m.set({ ax: 640 }); }

  int15(m: Machine) {
    if (m.get8('ah') === 0x86) {                 // wait CX:DX microseconds
      m.clock.sleep?.(Math.min((m.cx * 0x10000 + m.dx) / 1e6, 1.0));
      m.setFlag(CF, false);
    } else {
      m.set8('ah', 0x86);
      m.setFlag(CF, true);
    }
  }

  int17(m: Machine) {
    if (m.get8('ah') === 0x00) this.printer.write(Uint8Array.of(m.get8('al')));
    m.set8('ah', 0x90);                          // selected, not busy
  }

  int1a(m: Machine) {
    const ah = m.get8('ah');
    if (ah === 0x00) {
      this.tick();
      m.set({ cx: m.r16(BDA + 0x6E), dx: m.r16(BDA + 0x6C) });
      m.set8('al', 0);
    } else if (ah === 0x02) {
      const t = m.clock.wall();
      m.set({ cx: (bcd(t.getHours()) << 8) | bcd(t.getMinutes()), dx: bcd(t.getSeconds()) << 8 });
      m.setFlag(CF, false);
    } else if (ah === 0x04) {
      const t = m.clock.wall(), y = t.getFullYear();
      m.set({ cx: (bcd(Math.floor(y / 100)) << 8) | bcd(y % 100), dx: (bcd(t.getMonth() + 1) << 8) | bcd(t.getDate()) });
      m.setFlag(CF, false);
    } else m.setFlag(CF, false);
  }

  int33(m: Machine) { if (m.ax === 0) m.set({ ax: 0, bx: 0 }); }     // no mouse driver
  int67(m: Machine) { m.set8('ah', 0x84); }                          // EMS: function not supported
  int2f(m: Machine) { if ([0x1600, 0x4300, 0x4A00].includes(m.ax)) m.set8('al', 0); }
}
