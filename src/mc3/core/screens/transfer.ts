// Data Transfer ▸ … = MicroCOM III "Apply to Matrix" (MCOM upload window 1f71:09a6, spec 05 §4.4/§6),
// and Utilities ▸ Data Link Test (engine connection status).
import { pad3, production, refreshStatus, type Ctx } from '../ctx';
import { K } from '../keys';
import { GROUPS } from '../model';
import { clearMsg, msg, msgWait, wopen, type Win } from '../tcxl';

const TITLES: Record<string, [string, string]> = {
  index: ['Matrix Index Table Data', 'Uploading Index & Keypad Data to MicroCOM III Matrix!'],
  overlay: ['Matrix Index Overlay Data', 'Uploading Overlay Definitions to MicroCOM III Matrix!'],
  phantom: ['Phantom Code Overlay Data', 'Uploading Overlay Definitions to MicroCOM III Matrix!'],
  ifb: ['IFB/Program Sound Data', 'Uploading IFB/Program Sound Definitions to MicroCOM III Matrix!'],
  camera: ['Camera Assignment Data', 'Uploading Camera/ISO Definitions to MicroCOM III Matrix!'],
  epc: ['EPC Data', 'Uploading EPC Definitions to MicroCOM III Matrix!'],
  call: ['Call Array Data', 'Uploading Call Array Definitions to MicroCOM III Matrix!'],
  relay: ['Relay Definition Data', 'Uploading Relay Definitions to MicroCOM III Matrix!'],
  terminal: ['Terminal Assignment Data', 'Uploading Terminal Assignment Data to MicroCOM III Matrix!'],
  all: ['Production Data', 'Applying all changes of the Production to MicroCOM III Matrix!'],
};

const BAR = 37;

/** OpenTransferWindow: returns the window after ENTER, or null (aborted / off-line). */
export async function openTransferWindow(ctx: Ctx, prompt = true): Promise<Win | null> {
  const { rt, eng } = ctx;
  clearMsg(rt);
  rt.screen.hideCursor();
  const w = wopen(rt, 11, 20, 19, 62, 0, 0x2f, 0x2f);
  w.prints(0, 1, 0x2f, 'Prod:');
  w.prints(0, 7, 0x28, String(ctx.ws.current + 1).padStart(2, '0'));
  w.prints(1, 1, 0x2f, '╒╦════════╤════════╤════════╤════════╦╕');
  w.prints(2, 1, 0x2f, '│' + '░'.repeat(BAR) + '│');
  w.prints(3, 1, 0x2f, '└╨────────┴────────╨────────┴────────╨┘');
  w.prints(4, 1, 0x2f, ' 0%      25%      50%      75%     100%');
  w.prints(5, 1, 0x2f, 'Status:');
  w.prints(6, 1, 0x2f, 'Errors:');
  if (!eng.connected) {
    rt.screen.put(21, 70, 0x1f, 'OFF-LINE');
    msg(rt, 10, 'Matrix Engine not ON-LINE!  ...press any key to continue.');
    rt.beep();
    await rt.waitKey(1000);
    clearMsg(rt);
    w.close();
    return null;
  }
  rt.screen.put(21, 70, 0x1f, 'ON-LINE ');
  if (!prompt) return w;
  w.prints(5, 9, 0x24, 'Press <ENTER> to continue!');
  msg(rt, 10, 'Press <ENTER> to Upload Data, any other key to abort!');
  rt.flush();
  const k = await rt.getKey();
  clearMsg(rt);
  if (k !== K.ENTER) { w.close(); return null; }
  w.prints(5, 9, 0x24, ' '.repeat(29));
  return w;
}

/** Animate the progress bar from cell `from` to `to` (0..BAR). */
export async function progress(ctx: Ctx, w: Win, from: number, to: number) {
  for (let c = from; c < to; c++) {
    if (c > 0) w.printc(2, 1 + c, 0x28, '█');
    w.printc(2, 2 + c, 0x24, '█');
    await ctx.rt.sleep(12);
  }
}

/** Common epilogue: success / failure text, wait, close. */
export async function finishTransfer(ctx: Ctx, w: Win, ok: boolean, okText = 'Data Upload Complete!     ', err = '') {
  const { rt } = ctx;
  if (ok) {
    w.prints(2, 36, 0x28, '██');
    w.printc(2, 38, 0x24, '█');
  }
  w.prints(5, 9, 0x24, ok ? okText : 'Invalid Data Upload!      ');
  w.prints(6, 9, 0x24, ok ? '0' : '1');
  if (err) msg(rt, 1, err.slice(0, 78));
  await rt.waitKey(ok ? 1100 : 2200);
  clearMsg(rt);
  w.close();
  refreshStatus(ctx);
}

/** Run one apply with the MCOM progress window around it. */
export async function runTransfer(ctx: Ctx, title: string, rowMsg: string, send: () => Promise<number>, okText?: string) {
  const { rt } = ctx;
  const w = await openTransferWindow(ctx);
  if (!w) return;
  w.prints(0, 14, 0x28, title.slice(0, 26));
  msg(rt, Math.max(0, Math.floor((80 - rowMsg.length) / 2)), rowMsg);
  let pos = 0;
  let ok = true;
  let err = '';
  let n = 0;
  const job = send().then(v => { n = v; }, e => { ok = false; err = String((e as Error).message ?? e); });
  // the bar runs to ~80% while the engine works, then completes
  let done = false;
  void job.finally(() => { done = true; });
  while (!done && pos < BAR - 8) { await progress(ctx, w, pos, pos + 1); pos++; }
  await job;
  if (ok) await progress(ctx, w, pos, BAR - 1);
  if (ok && n === 0) okText = 'No changes - Matrix is current';
  await finishTransfer(ctx, w, ok, okText, err ? `Matrix Engine error: ${err}` : '');
}

/** Data Transfer pulldown items. */
export async function transfer(ctx: Ctx, group: string) {
  const p = await production(ctx);
  if (!p) return;
  const fields = group === 'all' ? undefined : GROUPS[group];
  if (!p.changed(fields).length) {
    await msgWait(ctx.rt, null, `No changes to apply - ${ctx.eng.fname(p.f)} ${TITLES[group][0]} is current in the Matrix.`);
    return;
  }
  const [title, rowMsg] = TITLES[group];
  await runTransfer(ctx, title, rowMsg, () => ctx.ws.apply(p.f, fields));
}

/** Utilities ▸ Data Link Test: engine connection and matrix status. */
export async function dataLinkTest(ctx: Ctx) {
  const { rt, eng } = ctx;
  const w = wopen(rt, 12, 36, 19, 76, 0, 0x2f, 0x2f);
  w.prints(0, 3, 0x24, 'Matrix Engine Status & Data Link Test');
  const draw = () => {
    w.prints(1, 1, 0x2f, 'Server:');
    w.prints(1, 9, 0x28, ctx.server.padEnd(29).slice(0, 29));
    w.prints(2, 1, 0x2f, 'Status:');
    w.prints(2, 9, 0x24, (eng.connected ? (eng.admin ? 'ON-LINE (operator)' : 'ON-LINE (panel only!)') : 'OFF-LINE').padEnd(29));
    w.prints(3, 1, 0x2f, 'Matrix:');
    const prof = eng.profile;
    w.prints(3, 9, 0x28, (prof ? `${prof.ports} ports, ${prof.facilities} x ${prof.slice}` : '-').padEnd(29));
    w.prints(4, 1, 0x2f, 'Configured:');
    const nconf = eng.configured.filter(Boolean).length;
    w.prints(4, 13, 0x28, `${pad3(nconf)} of ${pad3(eng.facilities)} Productions`.padEnd(27));
    w.prints(5, 1, 0x2f, 'Last error:');
    w.prints(5, 13, 0x28, (eng.lastError || 'none').padEnd(27).slice(0, 27));
  };
  msg(rt, 4, 'Testing Link to MicroCOM III Matrix Engine!  ...press any key to terminate.');
  rt.screen.hideCursor();
  for (;;) {
    draw();
    const t0 = Date.now();
    let rtt = '';
    try {
      await eng.getConfig(ctx.ws.current, 3000);
      rtt = `${Date.now() - t0} ms`;
    } catch (e) {
      rtt = (e as Error).message;
    }
    w.prints(2, 28, 0x24, rtt.padEnd(10).slice(0, 10));
    const k = await rt.waitKey(1000);
    if (k !== null || rt.keyReady) break;
  }
  if (rt.keyReady) await rt.getKey();
  clearMsg(rt);
  w.close();
}
