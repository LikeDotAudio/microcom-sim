// LED key legends for the MicroCOM 2026 station (pure): who a key reaches and how their name, role and
// emoji fit a 3-line red LED window, falling back to the 4-character MCOM mnemonic.
import type { PersonMeta, StationKey } from '../matrix/types';

export interface KeyLegend {
  emoji: string;
  /** line 1: mnemonic (always fits) */
  top: string;
  /** line 2: person's name (shortened to fit, or scrolled) */
  name: string;
  /** line 3: role */
  role: string;
  scrollName: boolean;
  scrollRole: boolean;
  /** full text for tooltips / screen readers */
  full: string;
}

const len = (s: string) => Array.from(s).length;

const ROLE_ABBR: Record<string, string> = {
  'Technical Director': 'Tech Dir', 'Floor Manager': 'Floor Mgr', 'Floor Manager 2': 'Floor Mgr2',
  Transmission: 'TX', Engineer: 'Eng', Graphics: 'Graphics', Captions: 'Captions', Producer: 'Producer',
  Director: 'Director',
};

/** Shorten a person's name to `max` characters: full, "First L.", "First", initials — else null (scroll). */
export function fitName(name: string, max: number): string | null {
  const n = name.trim().replace(/\s+/g, ' ');
  if (len(n) <= max) return n;
  const parts = n.split(' ');
  const first = parts[0], last = parts.length > 1 ? parts[parts.length - 1] : '';
  if (last && len(first) + 3 <= max) return `${first} ${Array.from(last)[0]}.`;
  if (len(first) <= max) return first;
  const ini = parts.map(p => Array.from(p)[0]).join('');
  return parts.length > 1 && len(ini) <= max ? ini : null;
}

/** Fit a role to `max` characters via known abbreviations ('Camera 3' → 'Cam 3'); null = scroll. */
export function fitRole(role: string, max: number): string | null {
  const r = role.trim();
  if (len(r) <= max) return r;
  const ab = ROLE_ABBR[r] ?? r.replace(/^Camera\b/, 'Cam').replace(/^Talent\b/, 'Tal').replace(/^Remote\b/, 'Rem')
    .replace(/^Utility\b/, 'Util');
  return len(ab) <= max ? ab : null;
}

/** Legend for a key whose target is described by `meta` (if any). */
export function keyLegend(key: StationKey, meta: PersonMeta | undefined, max: number): KeyLegend {
  const mn = key.kind === 'empty' ? '' : key.name.trim().toUpperCase();
  const blank: KeyLegend = { emoji: '', top: mn, name: '', role: '', scrollName: false, scrollRole: false, full: mn };
  if (key.kind === 'empty') return blank;
  if (key.kind === 'phantom') {
    const fam = mn.replace(/\d+$/, '');
    const desc = ({ GRP: 'Group', CA: 'Call', CMA: 'Cams', CNF: 'Conf', EV: 'Event', IS: 'ISO' } as Record<string, string>)[fam] ?? 'Phantom';
    return { ...blank, emoji: fam === 'GRP' ? '👥' : fam === 'CNF' ? '☎️' : '', name: desc, full: `${mn} ${desc}` };
  }
  if (!meta?.name) {
    const role = meta?.role ?? (key.kind === 'ext' ? 'Matrix key' : '');
    const r = fitRole(role, max);
    return { ...blank, emoji: meta?.emoji ?? '', role: r ?? role, scrollRole: r === null, full: `${mn} ${role}`.trim() };
  }
  const nm = fitName(meta.name, max);
  const role = meta.role ?? '';
  const r = fitRole(role, max);
  return {
    emoji: meta.emoji ?? '', top: mn.slice(0, max), name: nm ?? meta.name, role: r ?? role,
    scrollName: nm === null, scrollRole: r === null,
    full: [meta.emoji, meta.name, role && `· ${role}`, mn && `(${mn})`].filter(Boolean).join(' '),
  };
}

/** Which station a key reaches (single-target keys only). */
export function keyTarget(key: StationKey): number | null {
  if (key.kind === 'bus') return key.target ?? null;
  if (key.kind === 'ext' && key.targets?.length === 1) return key.targets[0];
  return null;
}

/** Characters per LED line for a window `w` units wide at font size `fs` (monospace ≈ 0.6 em). */
export const ledChars = (w: number, fs: number) => Math.max(1, Math.floor(w / (fs * 0.6)));
