// Production selector (Alt-P, Terminal Assignments ▸ Select Definition, Utilities ▸ Select Production),
// Copy Production (MCOM Copy Setup) and Printer Setup.
import { production, refreshStatus, type Ctx } from '../ctx';
import type { Cfg } from '../engine';
import { PRINTER_TYPES } from '../printer';
import { clearMsg, confirm, msg, msgWait, pickList } from '../tcxl';
import { pickProduction } from './assign';
import { finishTransfer, openTransferWindow, progress } from './transfer';

export async function selectProduction(ctx: Ctx) {
  const { ws } = ctx;
  const prev = ws.current;
  ctx.rt.helpCat = 7;
  const f = await pickProduction(ctx, prev, 'Select Production');
  if (f < 0 || f === prev) return;
  ws.current = f;
  refreshStatus(ctx);
  const p = await production(ctx);
  if (!p) { ws.current = prev; refreshStatus(ctx); return; }
  msg(ctx.rt, 12, `Production now set to ${ctx.eng.fname(f)} ${ctx.eng.prodName(f)}`);
  await ctx.rt.waitKey(700);
  clearMsg(ctx.rt);
  refreshStatus(ctx);
}

const MAPS = ['mnemonic', 'attr', 'term', 'desc', 'overlay', 'keys', 'groups'];

/** Utilities ▸ Copy Production: copy the active production's configuration onto another one. */
export async function copyProduction(ctx: Ctx) {
  const { rt, eng, ws } = ctx;
  const src = await production(ctx);
  if (!src) return;
  const t = await pickProduction(ctx, (src.f + 1) % eng.facilities, `Copy ${eng.fname(src.f)} to`);
  if (t < 0) return;
  if (t === src.f) { await msgWait(rt, 18, 'Cannot copy a Production onto itself!'); return; }
  if (!await confirm(rt, 8, `Copy ${eng.fname(src.f)} onto ${eng.fname(t)}, replacing its programming?  Press < ENTER > to confirm!`)) return;
  const w = await openTransferWindow(ctx, false);
  if (!w) return;
  w.prints(0, 14, 0x28, `Copy to ${eng.fname(t)}`);
  msg(rt, 10, `Copying ${eng.fname(src.f)} working copy to ${eng.fname(t)} in MicroCOM III Matrix!`);
  try {
    const dst: Cfg = await eng.getConfig(t);
    await progress(ctx, w, 0, 10);
    const changes: Record<string, unknown> = {};
    const s = src.cfg as unknown as Record<string, unknown>;
    const d = dst as unknown as Record<string, unknown>;
    for (const k of Object.keys(s)) {
      if (MAPS.includes(k)) {
        const m: Record<string, unknown> = { ...(s[k] as Record<string, unknown>) };
        for (const key of Object.keys(d[k] as Record<string, unknown>)) if (!(key in m)) m[key] = null;
        changes[k] = m;
      } else changes[k] = s[k];
    }
    const msgs: object[] = [{ t: 'setcfg', facility: t, changes }];
    const remap = (g: number) => {
      const [f, b] = eng.local(g);
      return f === src.f ? eng.gid(t, b) : g;
    };
    for (let b = 1; b <= src.N; b++) {
      const sg = String(src.gid(b));
      const tg = eng.gid(t, b);
      const ek = src.ext[sg] ?? [];
      if (ek.length || eng.extKeys[String(tg)]?.length) {
        msgs.push({ t: 'extkeys', gid: tg, keys: ek.map(k => ({ ...k, targets: k.targets.map(remap) })) });
      }
      const model = src.models[sg] ?? null;
      if (model !== (eng.panelModels[String(tg)] ?? null)) msgs.push({ t: 'panelmodel', gid: tg, model });
    }
    await eng.transact(t, msgs);
    await progress(ctx, w, 10, 36);
    const twc = ws.get(t);
    if (twc) twc.reset(await eng.getConfig(t));
    await finishTransfer(ctx, w, true, 'Production copied!        ');
  } catch (e) {
    await finishTransfer(ctx, w, false, '', `Matrix Engine error: ${(e as Error).message}`);
  }
}

/** Utilities ▸ Printer Setup (2379:0004): MicroCOM III prints to text files. */
export async function printerSetup(ctx: Ctx) {
  const { rt } = ctx;
  msg(rt, 14, 'Select Printer Type!  Printouts are saved as text files.');
  const ch = await pickList(rt, 10, 30, 14, 49, 0, 0x1f, 0x17, 0x2f, PRINTER_TYPES, ctx.printer.type);
  clearMsg(rt);
  if (ch >= 0) {
    ctx.printer.type = ch;
    await msgWait(rt, 20, `Printer set to ${PRINTER_TYPES[ch].trim()}`, false, 800);
  }
}
