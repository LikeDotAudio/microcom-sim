// Define System ▸ Camera Array (seg 13c3, spec 03 §2): 24 camera ISO circuits (ISnn) and eight camera
// arrays CMA1..CMA8 of up to 12 ISO buses each, with CPL (camera party line) / Sidetone flags.
import { pad3, production, type Ctx } from '../ctx';
import { K } from '../keys';
import type { Production } from '../model';
import { runPrint } from '../printer';
import { ASCII, clearMsg, editField, msg, wopen } from '../tcxl';
import { commit, num23, pairLine, valid } from './arrayUtil';
import { FILTER_1A82 } from './indexTable';

const isoLabel = (i: number) => `IS${String(i).padStart(2, '0')}`;

/** ISO auto-detect: bus with "CM"/"CAM" in its mnemonic and number i in chars 3-4. */
export function detectIso(p: Production): number[] {
  const iso = new Array(24).fill(0);
  for (let i = 1; i <= 24; i++) {
    for (let b = 1; b <= p.N; b++) {
      const mn = p.mn(b);
      if ((mn.includes('CM') || mn.includes('CAM')) && num23(mn) === i) { iso[i - 1] = b; break; }
    }
  }
  return iso;
}

export async function cameraArray(ctx: Ctx) {
  const { rt } = ctx;
  const p = await production(ctx);
  if (!p) return;
  let iso = p.cfg.iso.map(v => (valid(p, v) ? v : 0));
  if (!iso.some(v => v)) iso = detectIso(p);
  const cam = p.cfg.cam.map(v => (valid(p, v) ? v : 0));
  const flags = p.cfg.cam_flags.map(v => (v === 0xff ? 0 : v));
  /** Array (1..8) using ISO i, or 0 if free. */
  const used = (i: number) => {
    const b = iso[i - 1];
    if (!b) return 0;
    const k = cam.indexOf(b);
    return k < 0 ? 0 : Math.floor(k / 12) + 1;
  };

  const av = wopen(rt, 2, 56, 18, 76, 0, 0x30, 0x30);
  av.prints(0, 1, 0x30, '    Available');
  av.prints(1, 1, 0x30, ' Camera Circuits ');
  av.hline(2, 0, 20, 0, 0x30);
  av.vline(2, 4, 13, 0, 0x30);
  av.vline(2, 9, 13, 2, 0x30);
  av.vline(2, 14, 13, 0, 0x30);
  const drawAvail = () => {
    for (let i = 1; i <= 24; i++) {
      const r = 3 + ((i - 1) % 12);
      const c = i <= 12 ? 0 : 10;
      const b = iso[i - 1];
      if (!b) { av.prints(r, c, 0x38, isoLabel(i)); av.prints(r, c + 5, 0x38, '    '); continue; }
      av.prints(r, c, 0x31, isoLabel(i));
      av.prints(r, c + 5, used(i) ? 0x38 : 0x3f, p.mn(b));
    }
  };

  const w = wopen(rt, 1, 8, 21, 53, 0, 0x30, 0x30);
  w.prints(0, 0, 0x30, 'CAM: CMA1 CMA2 CMA3 CMA4 CMA5 CMA6 CMA7 CMA8');
  w.prints(1, 0, 0x30, 'OVL:');
  for (let a = 1; a <= 8; a++) w.prints(1, 5 * a, 0x34, (p.cfg.phantom[15 + a] ?? '').padEnd(4).slice(0, 4));
  w.hline(2, 0, 45, 0, 0x30);
  for (let c = 9; c <= 39; c += 5) w.vline(0, c, 17, 0, 0x30);
  w.hline(17, 0, 45, 0, 0x30);
  w.vline(0, 4, 18, 2, 0x30);
  w.prints(15, 1, 0x34, 'CPL');
  w.prints(16, 1, 0x34, 'ST');
  w.prints(18, 2, 0x30, 'F3..CPL   F5..Sidetone   F7..ISO Assign');
  for (let s = 1; s <= 12; s++) w.prints(2 + s, 1, 0x31, pad3(s));
  const marks = (a: number) => {
    const has = !!cam[(a - 1) * 12];
    w.printc(15, 5 * a + 2, 0x34, has && flags[a - 1] & 0x80 ? 'x' : ' ');
    w.printc(16, 5 * a + 2, 0x34, has && flags[a - 1] & 0x01 ? 'x' : ' ');
  };
  const cell = (attr: number, k: number) => {
    const a = Math.floor((k - 1) / 12) + 1;
    const s = ((k - 1) % 12) + 1;
    w.prints(2 + s, 5 * a, attr, cam[k - 1] ? p.mn(cam[k - 1]) : '    ');
    marks(a);
  };
  const all = () => { for (let k = 1; k <= 96; k++) cell(0x31, k); drawAvail(); };
  all();

  let a = 1;
  let wrow = 3;
  const kOf = () => (a - 1) * 12 + (wrow - 2);
  const save = () => {
    commit(p, 'iso', iso);
    commit(p, 'cam', cam);
    commit(p, 'cam_flags', flags);
  };
  const close = () => { w.close(); av.close(); clearMsg(rt); };
  const toggle = async (row: number, text: string, next: (f: number) => number, chain: boolean): Promise<boolean> => {
    msg(rt, 8, text);
    if (!cam[(a - 1) * 12]) return false;
    for (;;) {
      w.cursor(row, 5 * a + 2);
      const k = await rt.getKey();
      if (k === ' ') { flags[a - 1] = next(flags[a - 1]); marks(a); continue; }
      if (chain && k === K.F5) return true;
      if (k === K.ENTER || k === K.ESC || k === K.F10) return false;
    }
  };
  for (;;) {
    msg(rt, 2, '<TAB>..Next Array  <Shft TAB>..Prev Array  <F10>..Save/End  <ESC>..Abort');
    const k = kOf();
    cell(0x1f, k);
    const old = cam[k - 1];
    const r = await editField(rt, {
      row: w.top + wrow, col: w.left + 5 * a, width: 4, value: old ? p.mn(old) : '', upper: true, charOk: ASCII,
      validate: t => !t.trim() || iso.some(b => b && p.mn(b) === t.padEnd(4)),
    }, 0x1f, FILTER_1A82, 0x1f);
    if (r.key === K.ESC) { close(); return; }
    const t = r.value.padEnd(4);
    if (r.value.trim() && (!old || p.mn(old) !== t)) {
      const i = iso.findIndex((b, j) => b && p.mn(b) === t && !used(j + 1));
      if (i >= 0) cam[k - 1] = iso[i];
    }
    rt.screen.hideCursor();
    cell(0x31, k);
    drawAvail();
    switch (r.key) {
      case K.TAB: case K.STAB:
        a = r.key === K.TAB ? (a % 8) + 1 : a === 1 ? 8 : a - 1;
        while (!cam[kOf() - 1] && wrow > 3) wrow--;
        break;
      case K.ENTER: case K.DOWN: if (wrow < 14 && cam[k - 1]) wrow++; break;
      case K.UP: if (wrow > 3) wrow--; break;
      case K.CENTER: case K.F10:
        msg(rt, 18, 'Saving CAMERA ARRAY Table - please wait!');
        save();
        await rt.sleep(120);
        if (r.key === K.F10) { close(); return; }
        break;
      case K.F3: {
        const chain = await toggle(15, 'Press <SPACE> to toggle CPL Mode ON or OFF ,<ENTER> to accept.',
          f => (f === 0x80 ? 0 : f === 0x81 ? 0x01 : f === 0x01 ? 0x81 : 0x80), true);
        if (chain) await toggle(16, 'Press <SPACE> to toggle Sidetone ON or OFF ,<ENTER> to accept.',
          f => (f === 0x80 ? 0x81 : f === 0x81 ? 0x80 : f === 0x01 ? 0 : 0x01), false);
        rt.screen.hideCursor();
        break;
      }
      case K.F5:
        await toggle(16, 'Press <SPACE> to toggle Sidetone ON or OFF ,<ENTER> to accept.',
          f => (f === 0x80 ? 0x81 : f === 0x81 ? 0x80 : f === 0x01 ? 0 : 0x01), false);
        rt.screen.hideCursor();
        break;
      case K.F7: {
        // ISO Assign: re-detect the ISO circuits, purge array members that are no ISO bus
        iso = detectIso(p);
        for (let j = 0; j < 96; j++) if (cam[j] && !iso.includes(cam[j])) cam[j] = 0;
        all();
        break;
      }
      case K.SF6: {
        const base = (a - 1) * 12;
        const s = k - 1 - base;
        const arr = cam.slice(base, base + 12);
        arr.splice(s, 1);
        arr.push(0);
        // keep the array packed from slot 1
        const packed = [...arr.filter(x => x), ...arr.filter(x => !x)];
        for (let j = 0; j < 12; j++) cam[base + j] = packed[j];
        for (let j = 1; j <= 12; j++) cell(0x31, base + j);
        drawAvail();
        break;
      }
      case K.SF7: await printCamera(ctx, p, iso, cam, flags); break;
      default: break;
    }
  }
}

async function printCamera(ctx: Ctx, p: Production, iso: number[], cam: number[], flags: number[]) {
  const usedBy = (b: number) => { const k = cam.indexOf(b); return k < 0 ? 0 : Math.floor(k / 12) + 1; };
  await runPrint(ctx, 'Camera Array Data', 'Printing CAM/ISO Definition Data for current Production!',
    `${ctx.eng.fname(p.f)}-camera.txt`, pr => {
      pr.header('CAM/ISO Definition Data');
      pr.w(pr.BOLD);
      pr.centred(true, 'Available Camera Circuits');
      pr.w('\r\n\n                          Camera                 Current');
      pr.w('\r\n           ISO#    Bus#  Mnemonic   Overlay     Assignment  Avail.');
      pr.w(`\r\n           ${pr.UL}${' '.repeat(55)}\r\n\n${pr.NOUL}${pr.NOBOLD}`);
      let lines = 13;
      for (let i = 1; i <= 24; i++) {
        const b = iso[i - 1];
        if (!valid(p, b)) pr.w(`           ${isoLabel(i)}`);
        else {
          const u = usedBy(b);
          const assign = u ? `CMA${u}` : '....';
          pr.w(`           ${isoLabel(i)}     ${pad3(b)}    ${p.mn(b)}      ${p.ovl(b)}          ${assign}      ${u ? ' ' : 'Y'}`);
        }
        pr.w('\n\r');
        lines++;
      }
      pr.footer(lines);
      for (const pair of [[1, 3], [5, 7]]) {
        lines = 30;
        pr.header('CAM/ISO Definition Data');
        pr.w(`${pr.BOLD}\r\n\n`);
        pr.centred(true, 'Camera Array Assignments');
        pr.w(pr.NOBOLD);
        for (const a of pair) {
          const ov = (x: number) => (p.cfg.phantom[15 + x] ?? '').padEnd(4).slice(0, 4);
          const yn = (v: boolean) => (v ? 'YES' : 'NO ');
          pr.w('\r\n\n');
          pr.w(`        Array: CMA${a}  Overlay:  ${ov(a)}        Array: CMA${a + 1}  Overlay:  ${ov(a + 1)}\r\n`);
          pr.w(`        CPL:   ${yn(!!(flags[a - 1] & 0x80))}   Sidetone: ${yn(!!(flags[a - 1] & 1))}`);
          pr.w(`         CPL:   ${yn(!!(flags[a] & 0x80))}   Sidetone: ${yn(!!(flags[a] & 1))}\r\n\n`);
          pr.w(`${pr.BOLD}        Bus#  Mnemonic  Overlay            Bus#  Mnemonic  Overlay\r\n`);
          pr.w(`        ${pr.UL}${' '.repeat(61)}\r\n\n${pr.NOUL}${pr.NOBOLD}`);
          for (let s = 1; s <= 12; s++) { pairLine(pr, p, cam[(a - 1) * 12 + s - 1], cam[a * 12 + s - 1]); lines++; }
        }
        pr.w('\n\n        CPL .... Camera Party Line\r');
        pr.footer(lines + 2);
      }
    });
}
