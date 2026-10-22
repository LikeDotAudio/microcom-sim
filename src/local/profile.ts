// How the 2048-port matrix is sliced into virtual facilities (port of mcommatrix/profile.py).

export interface Section { kind: string; count: number; label: string }
export interface ProfileRaw {
  name: string; facilityPrefix: string; ports: number; slice: number; sections: Section[];
  mcomSize: number; tcpBase: number; httpPort: number;
}

export const DEFAULT_PROFILE: ProfileRaw = {
  name: 'WBS virtual MicroCOM II',
  facilityPrefix: 'PROD',
  ports: 2048,
  slice: 64,
  sections: [
    { kind: 'panel', count: 24, label: 'PNL' },
    { kind: 'ifb', count: 8, label: 'IFB' },
    { kind: 'remote', count: 16, label: 'RMT' },
    { kind: 'util', count: 16, label: 'UTL' },
  ],
  mcomSize: 96,
  tcpBase: 7000,
  httpPort: 8048,
};

export interface Port { gid: number; facility: number; local: number; kind: string; label: string }

export class Profile {
  readonly raw: ProfileRaw;
  readonly ports: number;
  readonly slice: number;
  readonly facilities: number;
  readonly tcpBase: number;
  readonly httpPort: number;
  readonly mcomSize: number;
  readonly prefix: string;
  readonly portList: Port[] = [];

  constructor(raw: Partial<ProfileRaw> = {}) {
    const r = this.raw = { ...DEFAULT_PROFILE, ...raw };
    this.ports = r.ports;
    this.slice = r.slice;
    this.facilities = Math.floor(this.ports / this.slice);
    this.tcpBase = r.tcpBase;
    this.httpPort = r.httpPort;
    this.mcomSize = r.mcomSize;
    this.prefix = r.facilityPrefix ?? 'PROD';
    const used = r.sections.reduce((n, s) => n + s.count, 0);
    if (used > this.slice) throw new Error(`profile sections use ${used} ports but slice is ${this.slice}`);
    const kinds: [string, string][] = [];
    for (const s of r.sections) for (let i = 0; i < s.count; i++) kinds.push([s.kind, `${s.label}${pad2(i + 1)}`]);
    for (let i = 0; i < this.slice - used; i++) kinds.push(['spare', `SPR${pad2(i + 1)}`]);
    for (let f = 0; f < this.facilities; f++) {
      kinds.forEach(([kind, lbl], i) => {
        const local = i + 1;
        this.portList.push({ gid: f * this.slice + local, facility: f, local, kind, label: `${this.fname(f)} ${lbl}` });
      });
    }
  }

  fname(f: number): string { return `${this.prefix}${pad2(f + 1)}`; }

  port(gid: number): Port {
    if (!(gid >= 1 && gid <= this.ports)) throw new Error(`port ${gid} out of range 1..${this.ports}`);
    return this.portList[gid - 1];
  }

  /** Global port for a MicroCOM bus number in a facility (null if outside the slice). */
  gid(facility: number, local: number): number | null {
    if (local >= 1 && local <= this.slice && facility >= 0 && facility < this.facilities) return facility * this.slice + local;
    return null;
  }

  describe() {
    return { name: this.raw.name, facilityPrefix: this.prefix, ports: this.ports, slice: this.slice,
      facilities: this.facilities, sections: this.raw.sections, mcomSize: this.mcomSize, tcpBase: this.tcpBase };
  }
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const pad3 = (n: number) => String(n).padStart(3, '0');
