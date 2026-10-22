// Demo programming for every facility, so a fresh matrix has something to route (port of
// mcommatrix/demo.py). Within each facility: 1-24 panels (1 = director, 2 = producer, 3 = TD,
// 4 = audio, 5-12 cameras CAM1-8, 13-24 misc), 25-32 IFB/Mic, 33-48 remotes, 49-64 utility.
import { FacilityConfig, KEY_LABELS } from './config';
import type { Profile } from './profile';
import type { ExtKey } from './routing';
import { pad2, pad3 } from './profile';

const ROLES = ['DIR', 'PRD', 'TD', 'AUD', 'CAM1', 'CAM2', 'CAM3', 'CAM4', 'CAM5', 'CAM6', 'CAM7', 'CAM8',
  'FM1', 'FM2', 'GFX', 'VTR', 'LD', 'EVS', 'SHD', 'TX', 'ENG', 'RF', 'CAP', 'STG'];
const TL = 0xc0;
const ljust4 = (s: string) => s.padEnd(4).slice(0, 4);

export function build(profile: Profile): [FacilityConfig[], Record<number, ExtKey[]>, Record<number, string>] {
  const facs: FacilityConfig[] = [];
  for (let f = 0; f < profile.facilities; f++) {
    const c = new FacilityConfig();
    c.size = Math.min(profile.mcomSize, 96);
    for (const p of profile.portList.slice(f * profile.slice, (f + 1) * profile.slice)) {
      const b = p.local;
      let mn: string;
      if (p.kind === 'panel') mn = b <= ROLES.length ? ROLES[b - 1] : `P${pad3(b)}`;
      else if (p.kind === 'ifb') mn = `IF${pad2(b - 24)}`;
      else if (p.kind === 'remote') mn = `R${pad2(b - 32)}`;
      else if (p.kind === 'util') mn = `U${pad2(b - 48)}`;
      else mn = `$${pad3(b)}`;
      c.mnemonic[b] = ljust4(mn);
      c.attr[b] = TL | (p.kind === 'ifb' ? 0x02 : 0);
      c.desc[b] = `${p.label} ${p.kind}`;
      c.term[b] = '0';
    }
    // panels: one of every 7800-series station across the facility
    const types: Record<number, string> = { 1: '6', 2: '4', 3: '2', 4: '8', 13: '3', 14: '9', 15: '7', 16: '5' };
    for (let b = 1; b <= 24; b++) {
      c.term[b] = types[b] ?? '1';
      const keys = Array.from({ length: 40 }, () => [0, 0]);
      let plan: [number, number][];
      if (b === 1) {                 // director: cameras, TD, audio, groups, call array, IFB
        plan = [[5, TL], [6, TL], [7, TL], [8, TL], [3, TL], [4, TL], [2, TL], [25, TL],
          [1, 0xc1], [2, 0xc1], [1, 0xc4], [1, 0xc3], [1, 0xc5], [1, 0xc6], [1, 0xcb], [33, TL]];
      } else if (b === 2) {          // producer: director, audio, every talent IFB (talk + listen)
        plan = [[1, TL], [4, TL], ...range(25, 33).map(t => [t, TL] as [number, number]), [1, 0xc1], [1, 0xc5], [34, TL]];
      } else if (b === 3) {
        plan = [[1, TL], [4, TL], [26, TL], [1, 0xc1], [1, 0xc5], [34, TL]];
      } else if (b >= 5 && b <= 12) { // cameras talk to director / TD
        plan = [[1, TL], [3, TL], [1, 0xc5]];
      } else {
        plan = [[1, TL], [2, TL], [b + 24 <= 48 ? b + 24 : 33, TL]];
      }
      const slots = KEY_LABELS[c.term[b]].map((l, i) => (l ? i : -1)).filter(i => i >= 0);
      const extra: [number, number][] = [...range(13, 25).filter(t => t !== b).map(t => [t, TL] as [number, number]),
        ...range(26, 33).map(t => [t, TL] as [number, number])];
      const all = [...plan, ...extra];
      for (let i = 0; i < Math.min(slots.length, all.length); i++) keys[slots[i]] = [all[i][0], all[i][1]];
      c.keys[b] = keys;
      c.groups[b] = [5, 6, 7, 8, 9, 10, 2, 3, 4, 0, 0, 0, ...Array(12).fill(0)];
    }
    c.call[0] = [5, 6, 7, 8, 9, 10, 11, 12, ...Array(16).fill(0)];
    c.call[1] = [33, 34, 35, 36, ...Array(20).fill(0)];
    c.cam.splice(0, 8, 5, 6, 7, 8, 9, 10, 11, 12);
    c.cam_flags = [0x81, 0, 0, 0, 0, 0, 0, 0];
    c.iso.splice(0, 8, 5, 6, 7, 8, 9, 10, 11, 12);
    for (let i = 0; i < 8; i++) {    // IFB n -> bus 25+n, program from remote 41+n
      c.ifb_bus[i] = 25 + i;
      c.ifb_pgm[i] = 41 + i;
    }
    c.ifb_mode = 1;
    c.pgm_limit = 48;
    c.relay_out[0] = 49;             // relay 1 follows talk into UTL01 (e.g. a cue light)
    c.relay_mask[0] = 'ff'.repeat(30);
    c.epc = [
      { in: 33, out: 4, type: 0x40, ext: 0xff, comment: 'R01 to AUD perm' },
      { in: 1, out: 49, type: 0xc4, ext: 1, comment: 'EV01 DIR<>UTL01' },
      { in: 34, out: 1, type: 0x42, ext: 1, comment: 'XT01 R02 to DIR' },
    ];
    c.keypad = ['$0..', '$1..', '$2..', ...Array(12).fill('    '), 'IF..', '    ', '    '];
    c.phantom.splice(0, 4, 'CAMS', 'PROD', '    ', '    ');
    facs.push(c);
  }
  // cross-facility extended keys: each director can talk to the next facility's director and a shared
  // master control (last facility, panel 1)
  const ext: Record<number, ExtKey[]> = {};
  const nf = profile.facilities, last = nf - 1;
  for (let f = 0; f < nf; f++) {
    const d = profile.gid(f, 1)!;
    const nxt = profile.gid((f + 1) % nf, 1)!;
    const mcr = profile.gid(last, 1)!;
    ext[d] = [{ label: `P${pad2(((f + 1) % nf) + 1)}`, targets: [nxt], talk: true, listen: true },
      { label: 'MCR', targets: [mcr], talk: true, listen: true }];
  }
  // matrix panel models: every producer gets a 32-key M7832; master control gets a 64-key M7864
  const models: Record<number, string> = {};
  for (let f = 0; f < nf; f++) {
    const prd = profile.gid(f, 2)!;
    models[prd] = 'M7832';
    ext[prd] = range(1, 17).map(i => ({ label: `D${pad2(((f + i) % nf) + 1)}`,
      targets: [profile.gid((f + i) % nf, 1)!], talk: true, listen: true }));
  }
  models[profile.gid(0, 2)!] = 'M2026P';   // PROD01 producer: MicroCOM 2026 producer panel
  models[profile.gid(0, 4)!] = 'M2026';    // PROD01 audio: MicroCOM 2026 station
  const mcr = profile.gid(last, 1)!;
  models[mcr] = 'M7864';
  ext[mcr] = range(0, nf - 1).map(f => ({ label: `D${pad2(f + 1)}`, targets: [profile.gid(f, 1)!], talk: true, listen: true }));
  ext[mcr].push({ label: 'ALL', targets: range(0, nf - 1).map(f => profile.gid(f, 1)!), talk: true, listen: false });
  return [facs, ext, models];
}

function range(a: number, b: number): number[] {
  return Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
}

// ---- MicroCOM 2026 demo: people and places --------------------------------------------------------
const SITES: [string, string, number, number][] = [
  ['Toronto', 'Broadcast Centre', 43.6426, -79.3871], ['Vancouver', 'Pacific Studios', 49.2827, -123.1207],
  ['Montreal', 'Maison Radio', 45.5163, -73.5536], ['New York', 'West 57th Studios', 40.7655, -73.9800],
  ['London', 'White City', 51.5094, -0.2264], ['Sydney', 'Harbour Studios', -33.8688, 151.2093],
  ['Tokyo', 'Shibuya Broadcast', 35.6580, 139.7016], ['Calgary', 'Foothills Centre', 51.0447, -114.0719]];
const SHOWS = ['Hockey Night', 'Morning Live', 'Evening News', 'Studio 4 Talk', 'The Big Game', 'Market Watch',
  'Late Show', 'Weather Centre', 'Drive Home', 'Kids Club', 'Election Desk', 'Cooking Live',
  'Concert Hall', 'Sports Desk', 'Breakfast Show', 'Arts Hour', 'Global Report', 'Soccer Sunday',
  'Tech Today', 'Quiz Night', 'Nature Live', 'Courtside', 'Health Matters', 'Racing Live',
  'Comedy Hour', 'World Cup', 'News at Noon', 'Music Awards', 'Travel Show', 'Science Now',
  'Gala Night', 'Master Control'];
const FIRST = ['Ava', 'Ben', 'Chloe', 'Dev', 'Elena', 'Femi', 'Grace', 'Hiro', 'Isla', 'Jamal', 'Kira', 'Liam',
  'Maya', 'Noah', 'Olu', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tara', 'Uma', 'Victor', 'Wen', 'Yara', 'Zane'];
const LAST = ['Adams', 'Brooks', 'Chen', 'Dubois', 'Evans', 'Fischer', 'Gupta', 'Haddad', 'Ito', 'Jensen', 'Kowalski',
  'Lopez', 'Moreau', 'Nakamura', 'Okafor', 'Patel', 'Quinn', 'Rossi', 'Singh', 'Tremblay', 'Ueda', 'Vargas',
  'Walsh', 'Xu', 'Young', 'Zimmer'];
const ROLE: Record<string, [string, string]> = {
  DIR: ['Director', '🎬'], PRD: ['Producer', '📋'], TD: ['Technical Director', '🎛️'],
  AUD: ['Audio', '🎚️'], FM1: ['Floor Manager', '🧭'], FM2: ['Floor Manager 2', '🧭'],
  GFX: ['Graphics', '🖼️'], VTR: ['Replay', '⏪'], LD: ['Lighting', '💡'], EVS: ['Slo-mo', '🐢'],
  SHD: ['Shader', '🎨'], TX: ['Transmission', '📡'], ENG: ['Engineer', '🔧'], RF: ['RF', '📶'],
  CAP: ['Captions', '💬'], STG: ['Stage', '🎭'] };

export type Meta = Record<string, unknown>;

export function buildMeta(profile: Profile, facs: FacilityConfig[]): [Record<number, Meta>, Record<number, Meta>] {
  const meta: Record<number, Meta> = {}, facMeta: Record<number, Meta> = {};
  let n = 0;
  const camNo = (mn: string) => (mn.slice(3) ? parseInt(mn.slice(3), 10) : 0);
  for (let f = 0; f < profile.facilities; f++) {
    const [city, building, lat, lon] = SITES[Math.floor(f / 4) % SITES.length];
    facMeta[f] = { name: SHOWS[f % SHOWS.length], site: city, building, lat, lon };
    const floor = (f % 4) + 1;
    for (const p of profile.portList.slice(f * profile.slice, (f + 1) * profile.slice)) {
      const b = p.local;
      const mn = (facs[f].mnemonic[b] ?? '').trim();
      let person = `${FIRST[n % FIRST.length]} ${LAST[(n * 7) % LAST.length]}`;
      n += 1;
      let loc: Meta = { site: city, building, floor, lat, lon };
      let role: string, emoji: string;
      if (p.kind === 'panel') {
        [role, emoji] = ROLE[mn] ?? (mn.startsWith('CAM') ? ['Camera ' + mn.slice(3), '🎥'] : ['Crew', '🎧']);
        if (mn.startsWith('CAM')) {
          loc = { ...loc, room: `Studio ${f + 1}`, row: 1, seat: camNo(mn), x: 2 + 3 * camNo(mn), y: 8 };
        } else {
          const i = b <= 4 ? b - 1 : b - 9;
          loc = { ...loc, room: `Control Room ${f + 1}`, row: Math.floor(i / 4) + 1, seat: (i % 4) + 1,
            x: 1.5 + 1.6 * (i % 4), y: 2 + 2 * Math.floor(i / 4) };
        }
      } else if (p.kind === 'ifb') {
        [role, emoji] = [`Talent ${b - 24}`, '🎤'];
        loc = { ...loc, room: `Studio ${f + 1}`, row: 2, seat: b - 24, x: 2 + 2.5 * (b - 24), y: 4 };
      } else if (p.kind === 'remote') {
        [role, emoji] = [`Remote ${b - 32}`, '🛰️'];
        person = `${['Arena', 'Stadium', 'Field', 'Bureau'][b % 4]} ${b - 32}`;
        loc = { site: 'Remote', lat: lat + 0.05 * ((b % 5) - 2), lon: lon + 0.07 * ((b % 3) - 1) };
      } else {
        [role, emoji] = [`Utility ${b - 48}`, '🔌'];
        person = `Utility ${b - 48}`;
        loc = { ...loc, room: 'Equipment Room', row: 1, seat: b - 48 };
      }
      meta[p.gid] = { name: person, role, emoji, location: loc };
    }
  }
  return [meta, facMeta];
}
