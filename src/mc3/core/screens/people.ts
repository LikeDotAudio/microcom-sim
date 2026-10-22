// Utilities ▸ People & Places (per-port person and location, engine `meta`) and Production Setup
// (per-production name and site, engine `facmeta`). New in MicroCOM III; drawn in MCOM style.
import { pad3, production, refreshStatus, type Ctx } from '../ctx';
import type { FacMeta, Location, Meta } from '../engine';
import { K } from '../keys';
import type { Production } from '../model';
import { cells, fit } from '../screen';
import { clearMsg, form, msg, msgWait, NUMERIC, wopen, type Field } from '../tcxl';

const where = (l: Location | undefined): string => {
  if (!l) return '';
  const parts: string[] = [];
  if (l.room) parts.push(String(l.room));
  if (l.row !== undefined && l.row !== null && l.row !== '') parts.push(`R${l.row}`);
  if (l.seat !== undefined && l.seat !== null && l.seat !== '') parts.push(`S${l.seat}`);
  if (!parts.length && l.site) parts.push(String(l.site));
  return parts.join(' ');
};

const num = (v: string): number | string | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : t;
};
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));

export async function peoplePlaces(ctx: Ctx) {
  const { rt, eng } = ctx;
  const p = await production(ctx);
  if (!p) return;
  const N = p.N;
  const w = wopen(rt, 3, 1, 18, 78, 0, 0x30, 0x30);
  w.prints(0, 0, 0x30, 'Bus│Code│  │ Name                   │ Role              │ Location');
  w.hline(1, 0, 76, 0, 0x30);
  for (const c of [3, 8, 11, 36, 56]) w.vline(0, c, 14, 0, 0x30);
  w.title(` People & Places - ${eng.fname(p.f)} ${eng.prodName(p.f)} `.slice(0, 70), 2, 0x30);
  const meta = (b: number): Meta => eng.meta[String(p.gid(b))] ?? {};
  const line = (attr: number, row: number, b: number) => {
    if (b < 1 || b > N) return;
    const m = meta(b);
    w.prints(row, 0, attr, pad3(b));
    w.prints(row, 4, attr, p.mn(b));
    const e = cells(m.emoji ?? '')[0] ?? ' ';
    w.prints(row, 9, attr, e + ' ');   // emoji are double width in terminals: keep a blank after
    w.prints(row, 12, attr, fit(m.name ?? '', 24));
    const kind = p.kind(b);
    w.prints(row, 37, attr, fit(m.role ?? (kind === 'ifb' ? 'Talent' : ''), 19));
    w.prints(row, 57, attr, fit(where(m.location), 19));
  };
  let top = 1;
  let row = 2;
  const paint = () => { for (let i = 0; i < 12; i++) line(0x31, 2 + i, top + i); };
  paint();
  rt.helpCat = 5;
  for (;;) {
    const b = top + row - 2;
    msg(rt, 6, 'ENTER..Edit Person & Place   F9..Production Setup   ESC/F10..Exit');
    line(0x1f, row, b);
    rt.screen.hideCursor();
    const k = await rt.getKey();
    line(0x31, row, b);
    if (k === K.ESC || k === K.F10) { w.close(); return; }
    if (k === K.DOWN) { if (b < N) { if (row < 13) row++; else { top++; paint(); } } }
    else if (k === K.UP) { if (b > 1) { if (row > 2) row--; else { top--; paint(); } } }
    else if (k === K.HOME) { top = 1; row = 2; paint(); }
    else if (k === K.END) { top = Math.max(1, N - 11); row = 2 + N - top; paint(); }
    else if (k === K.PGUP) { top = Math.max(1, top - 12); row = 2; paint(); }
    else if (k === K.PGDN) { top = Math.min(Math.max(1, N - 11), top + 12); row = 2; paint(); }
    else if (k === K.ENTER) { await editPerson(ctx, p, b); paint(); }
    else if (k === K.F9) { await productionSetup(ctx); w.title(` People & Places - ${eng.fname(p.f)} ${eng.prodName(p.f)} `.slice(0, 70), 2, 0x30); }
  }
}

async function editPerson(ctx: Ctx, p: Production, bus: number) {
  const { rt, eng } = ctx;
  const gid = p.gid(bus);
  const m: Meta = eng.meta[String(gid)] ?? {};
  const l: Location = m.location ?? {};
  const w = wopen(rt, 5, 9, 19, 70, 0, 0x2f, 0x2f);
  const kind = p.kind(bus);
  w.title(` ${eng.fname(p.f)} Bus ${pad3(bus)} ${p.mn(bus).trim()} (${kind === 'ifb' ? 'talent' : kind}) `, 2, 0x2f);
  const labels: [number, number, string][] = [
    [0, 1, 'Name:'], [1, 1, 'Role:'], [2, 1, 'Emoji:'], [4, 1, 'Site:'], [5, 1, 'Building:'],
    [6, 1, 'Floor:'], [6, 26, 'Room:'], [7, 1, 'Row:'], [7, 26, 'Seat:'], [8, 1, 'X (m):'], [8, 26, 'Y (m):'],
    [9, 1, 'Latitude:'], [9, 26, 'Longitude:'],
  ];
  for (const [r, c, t] of labels) w.prints(r, c, 0x2f, t);
  w.prints(3, 1, 0x2e, 'Location');
  if (kind === 'ifb') w.prints(11, 1, 0x2e, 'Talent position: IFB earpiece, listen-only mic.');
  const at = (r: number, c: number) => ({ row: w.top + r, col: w.left + c });
  const fields: Field[] = [
    { ...at(0, 12), width: 40, value: m.name ?? '' },
    { ...at(1, 12), width: 40, value: m.role ?? '' },
    { ...at(2, 12), width: 2, value: m.emoji ?? '' },
    { ...at(4, 12), width: 30, value: str(l.site) },
    { ...at(5, 12), width: 30, value: str(l.building) },
    { ...at(6, 12), width: 8, value: str(l.floor) },
    { ...at(6, 37), width: 20, value: str(l.room) },
    { ...at(7, 12), width: 8, value: str(l.row) },
    { ...at(7, 37), width: 8, value: str(l.seat) },
    { ...at(8, 12), width: 10, value: str(l.x), charOk: NUMERIC },
    { ...at(8, 37), width: 10, value: str(l.y), charOk: NUMERIC },
    { ...at(9, 12), width: 11, value: str(l.lat), charOk: NUMERIC },
    { ...at(9, 37), width: 11, value: str(l.lon), charOk: NUMERIC },
  ];
  // emoji: one grapheme; shown in one cell
  fields[2].value = cells(fields[2].value)[0] ?? '';
  msg(rt, 6, 'Editing Person & Place!  <F10> saves to Matrix, <ESC> aborts.');
  const res = await form(rt, fields, 0x20, 0x2f);
  clearMsg(rt);
  if (res.key === K.ESC) { w.close(); return; }
  const v = res.values;
  const emoji = cells(v[2].trim())[0] ?? '';
  const meta = {
    name: v[0].trim(), role: v[1].trim(), emoji,
    location: {
      site: v[3].trim() || null, building: v[4].trim() || null, floor: num(v[5]), room: v[6].trim() || null,
      row: num(v[7]), seat: num(v[8]), x: num(v[9]), y: num(v[10]), lat: num(v[11]), lon: num(v[12]),
    },
  };
  msg(rt, 18, 'Saving Person & Place, please wait!', 0x47);
  try {
    await eng.transact(p.f, [{ t: 'meta', gid, meta }]);
    const loc: Location = {};
    for (const [k, val] of Object.entries(meta.location)) if (val !== null) (loc as Record<string, unknown>)[k] = val;
    const nm: Meta = { location: { ...(m.location ?? {}), ...loc } };
    if (meta.name) nm.name = meta.name;
    if (meta.role) nm.role = meta.role;
    if (meta.emoji) nm.emoji = meta.emoji;
    eng.meta[String(gid)] = nm;
    clearMsg(rt);
  } catch (e) {
    await msgWait(rt, 4, `Matrix Engine error: ${(e as Error).message}`.slice(0, 72));
  }
  w.close();
}

/** Utilities ▸ Production Setup: production name, site, building, coordinates (facmeta). */
export async function productionSetup(ctx: Ctx) {
  const { rt, eng, ws } = ctx;
  const f = ws.current;
  const fm: FacMeta = eng.facMeta[String(f)] ?? {};
  const w = wopen(rt, 8, 14, 18, 66, 0, 0x2f, 0x2f);
  w.centers(0, 0x2f, `Production Setup  ${eng.fname(f)}`);
  const rows: [string, string, number][] = [
    ['Name:', fm.name ?? '', 28], ['Site:', fm.site ?? '', 28], ['Building:', fm.building ?? '', 28],
    ['Latitude:', str(fm.lat), 11], ['Longitude:', str(fm.lon), 11],
  ];
  rows.forEach(([l], i) => w.prints(2 + i, 1, 0x2f, l));
  const prof = eng.profile;
  const secs = prof?.sections.map(s => `${s.count} ${s.label}`).join(', ') ?? '';
  w.prints(8, 1, 0x2e, `Ports: ${pad3(eng.slice)}  ${secs}`.slice(0, w.width - 1));
  const fields: Field[] = rows.map(([, v, width], i) => ({ row: w.top + 2 + i, col: w.left + 13, width, value: v,
    charOk: i >= 3 ? NUMERIC : undefined }));
  msg(rt, 10, 'Please Enter Production Name and Site!  <F10> saves, <ESC> aborts.');
  const res = await form(rt, fields, 0x20, 0x2f);
  clearMsg(rt);
  if (res.key !== K.ESC) {
    const v = res.values.map(s => s.trim());
    const meta: FacMeta = { name: v[0], site: v[1], building: v[2] };
    const lat = num(v[3]); const lon = num(v[4]);
    if (lat !== null) meta.lat = lat as number;
    if (lon !== null) meta.lon = lon as number;
    try {
      await eng.transact(f, [{ t: 'facmeta', facility: f, meta }]);
      eng.facMeta[String(f)] = { ...fm, ...meta };
      msg(rt, 16, '       *** Saving Production Setup! ***         ');
      await rt.waitKey(600);
    } catch (e) {
      await msgWait(rt, 4, `Matrix Engine error: ${(e as Error).message}`.slice(0, 72));
    }
    clearMsg(rt);
  }
  w.close();
  refreshStatus(ctx);
}

