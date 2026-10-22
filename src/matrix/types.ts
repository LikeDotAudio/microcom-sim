// Wire types of the matrix engine WebSocket API (see mcom-tui/mcommatrix/server.py).

export type RouteKind =
  | 'talk' | 'listen' | 'listen-lm' | 'grp' | 'call' | 'cam' | 'iso' | 'conf'
  | 'event' | 'perm' | 'xt' | 'cpl' | 'pgm' | 'ext';

/** [src, dst, kind, gain, via] — audio from src's input (mic) to dst's output (speaker). */
export type RouteTuple = [number, number, RouteKind, number, string];
/** [gid, kind, label, mnemonic, overlay, termType, hasKeys] */
export type PortTuple = [number, string, string, string, string, string, number];
/** [facility (0-based), relay (1-12), closed] */
export type RelayTuple = [number, number, boolean];
/** [gid, slot, 'latch' | 'press'] */
export type ActiveTuple = [number, number, 'latch' | 'press'];

export interface Section { kind: string; count: number; label: string }
export interface ProfileInfo {
  name: string; facilityPrefix?: string; ports: number; slice: number; facilities: number;
  sections: Section[]; mcomSize: number; tcpBase: number;
}

export interface EpcEntry { in: number; out: number; type: number; ext: number; comment: string }

export interface FacilityInfo {
  id: number; configured: boolean; size: number; ifbMode: number; pgmLimit: number;
  keypad: string[]; phantom: string[]; relayOut: number[]; epc: EpcEntry[];
  call: number[][]; cam: number[]; camFlags: number[]; iso: number[];
  ifbBus: number[]; ifbPgm: number[];
}

export interface Faults { offline: boolean; nak_every: number; busy: boolean }
export interface LinkStatus {
  facility: number; port: number; connected: boolean; faults: Faults; blocks: number; lastRx: number;
}

export interface LogEvent { id: number; t: number; kind: string; text: string; facility: number | null }

export interface ExtKey { label: string; targets: number[]; talk: boolean; listen: boolean }

export interface Snapshot {
  profile: ProfileInfo;
  ports: PortTuple[];
  facilities: FacilityInfo[];
  links: LinkStatus[];
  routes: RouteTuple[];
  relays: RelayTuple[];
  active: ActiveTuple[];
  xt: [number, number][];
  events: LogEvent[];
  extKeys: Record<string, ExtKey[]>;
  talent?: TalentMap;
  /** MicroCOM 2026: people & places */
  meta?: Record<string, PersonMeta>;
  facMeta?: Record<string, FacMeta>;
}

// ---- MicroCOM 2026: people & places, recently said, proximity ------------------------------------
export interface Location {
  site?: string; building?: string; floor?: number; room?: string; row?: number; seat?: number;
  x?: number; y?: number; lat?: number; lon?: number;
}
export interface PersonMeta { name?: string; role?: string; emoji?: string; location?: Location }
export interface FacMeta { name?: string; site?: string; building?: string; lat?: number; lon?: number }
/** [start, end, word] — seconds from the segment start */
export type SaidWord = [number, number, string];
export interface SaidItem {
  id: number; src: number; dsts: number[]; t0: number; t1: number;
  text: string | null; words: SaidWord[] | null;
}
export interface Blip { id: number; gid: number; in: number; dur: number; band: [number, number] }
/** [a, b, smoothed SNR dB] — learned same-room pair */
export type NearPair = [number, number, number];

export interface StationKey {
  slot: number; label: string; kind: 'bus' | 'phantom' | 'ext' | 'empty'; name: string;
  mode?: string; target?: number | null; targets?: number[]; bus?: number;
  code?: number; attr?: number; on: null | 'latch' | 'press';
}

export interface Station {
  gid: number; label: string; kind: string; facility: number; local: number; type: string;
  typeName: string; mnemonic: string; overlay: string; keys: StationKey[]; groups: number[];
  panelModel?: string | null; capacity?: number;
  talent?: { mic: boolean; cough: boolean; ifb: number; pgm: number | null } | null;
}

export type ServerMsg =
  | { t: 'snapshot'; state: Snapshot }
  | { t: 'routes'; routes: RouteTuple[]; relays: RelayTuple[]; active: ActiveTuple[]; xt: [number, number][]; talent?: TalentMap }
  | { t: 'levels'; levels: Record<string, number> }
  | { t: 'event'; e: LogEvent }
  | { t: 'links'; links: LinkStatus[] }
  | { t: 'station'; station: Station | null }
  | { t: 'error'; message: string }
  | { t: 'hello'; admin: boolean; gid: number | null }
  | { t: 'panellink'; gid: number; url: string }
  | { t: 'audio'; on: boolean; gid: number | null }
  | { t: 'meta'; gid: number; meta: PersonMeta }
  | { t: 'facmeta'; facility: number; meta: FacMeta }
  | { t: 'history'; gid: number; items: SaidItem[] }
  | { t: 'said'; item: SaidItem }
  | ({ t: 'blip' } & Blip)
  | { t: 'near'; near: NearPair[] };

export type ClientMsg =
  | { t: 'key'; gid: number; slot: number; action: 'press' | 'release' | 'toggle' }
  | { t: 'xt'; facility: number; n: number; on: boolean }
  | { t: 'clear' }
  | { t: 'station'; gid: number }
  | { t: 'extkeys'; gid: number; keys: ExtKey[] }
  | { t: 'panelmodel'; gid: number; model: string | null }
  | { t: 'panellink'; gid: number }
  | { t: 'audio'; on: boolean; gid?: number }
  | { t: 'talent'; gid: number; mic?: boolean; cough?: boolean }
  | { t: 'fault'; facility: number; faults: Partial<Faults> }
  | { t: 'meta'; gid: number; meta: Partial<PersonMeta> }
  | { t: 'facmeta'; facility: number; meta: Partial<FacMeta> }
  | { t: 'history'; gid: number }
  | { t: 'heard'; gid: number; blip: number; emitter: number; snr: number }
  | { t: 'near' };

/** Route kinds that count as "talking" (mirrors routing.TALK_KINDS). */
export const TALK_KINDS: ReadonlySet<RouteKind> = new Set<RouteKind>(
  ['talk', 'grp', 'call', 'cam', 'iso', 'conf', 'event', 'perm', 'xt', 'ext']);
export const LISTEN_KINDS: ReadonlySet<RouteKind> = new Set<RouteKind>(['listen', 'listen-lm']);

export const ROUTE_KINDS: RouteKind[] = [
  'talk', 'listen', 'listen-lm', 'grp', 'call', 'cam', 'iso', 'conf', 'event', 'perm', 'xt',
  'cpl', 'pgm', 'ext'];

export interface Route { src: number; dst: number; kind: RouteKind; gain: number; via: string }

export interface TalentState { mic: boolean; cough: boolean }
export type TalentMap = Record<string, TalentState>;

export interface Port {
  gid: number; kind: string; label: string; mnemonic: string; overlay: string;
  termType: string; hasKeys: boolean; facility: number; local: number;
}
