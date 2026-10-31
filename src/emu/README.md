# src/emu: MCOM.EXE in the browser

`emu.html` runs the unmodified MicroCOM II Assignment Software (MCOM.EXE v3.20) on an emulated
PC written in TypeScript. It is the browser counterpart of `mcom-tui/mcomtui` (Python + Unicorn),
file for file:

| here | mcom-tui | what |
|---|---|---|
| `cpu.ts` | Unicorn | real-mode x86: 8086 + 186/286 real-mode opcodes, QEMU's flag choices |
| `machine.ts` | `machine.py` | MZ loader (PSP at 0FF0h, so code sits at 1000:0000 as in the Ghidra listing), INT/IRQ/port dispatch |
| `bios.ts` | `bios.py` | INT 10h/16h/1Ah…, BIOS data area, text screen at B800:0000 |
| `dos.ts`, `drive.ts` | `dos.py` | INT 21h subset on an in-memory drive C: |
| `uart.ts` | `uart.py` | 8250 + INT 14h, serial.log |
| `sim.ts` | `matrix_sim.py` | the simple simulated frame |
| `pc.ts` | `__main__.py` | the host loop: slice, timer tick, serial poll |
| `screen.ts`, `keys.ts` (CP437 from `../mc3/core/cp437.ts`, the one table) | `terminal.py` | canvas renderer, browser keys → BIOS codes |
| `store.ts` | — | drive C: in IndexedDB |
| `link.ts` | `--com1` | COM1: none, `sim.ts`, or a frame of the in-browser engine (`src/local/frameLink.ts`) |

MCOM.EXE is copyrighted and is **not** part of the site: the visitor loads their own copy, which
stays in their browser.

## Faithfulness

`test/emu-diff.test.ts` runs the TypeScript PC and the Unicorn PC side by side on the real
MCOM.EXE with time frozen (`test/emu-ref/`): the first 300,000 instructions register for register
(`EMU_TRACE_N` raises it; 4,000,000 also match), the registers at the end of every host-loop slice
for whole sessions (New Configuration, Define System and the Matrix Index Table, an Index & Keypad
upload, the Data Link Test), and the final screens, files and serial bytes. It skips when MCOM.EXE
or mcom-tui's `.venv` is missing.
