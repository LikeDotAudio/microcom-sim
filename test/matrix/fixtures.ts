import type { PortTuple, RouteTuple, Snapshot } from '../../src/matrix/types';

/** Small 2-facility × 64 profile snapshot (128 ports). */
export function snapshot(routes: RouteTuple[] = []): Snapshot {
  const ports: PortTuple[] = [];
  for (let gid = 1; gid <= 128; gid++) {
    const f = Math.floor((gid - 1) / 64), local = ((gid - 1) % 64) + 1;
    ports.push([gid, local <= 24 ? 'panel' : 'util', `F0${f + 1} P${String(local).padStart(2, '0')}`,
      local === 1 ? 'DIR ' : '', '', local <= 24 ? '1' : '', local <= 24 ? 1 : 0]);
  }
  return {
    profile: { name: 'test', ports: 128, slice: 64, facilities: 2, sections: [], mcomSize: 96, tcpBase: 7000 },
    ports, facilities: [], routes,
    links: [{ facility: 0, port: 7000, connected: true, faults: { offline: false, nak_every: 0, busy: false }, blocks: 3, lastRx: 1 },
      { facility: 1, port: 7001, connected: false, faults: { offline: false, nak_every: 0, busy: false }, blocks: 0, lastRx: 0 }],
    relays: [[0, 1, false], [1, 1, true]], active: [[1, 0, 'latch']], xt: [[0, 1]],
    events: [{ id: 1, t: 1, kind: 'config', text: 'hello', facility: null }],
    extKeys: { '1': [{ label: 'F02', targets: [65], talk: true, listen: true }] },
  };
}
