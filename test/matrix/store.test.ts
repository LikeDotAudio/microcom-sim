import { describe, expect, it } from 'vitest';
import { MAX_EVENTS, Store } from '../../src/matrix/store';
import { snapshot } from './fixtures';

describe('Store', () => {
  it('applies a snapshot', () => {
    const s = new Store();
    let topics: string[] = [];
    s.subscribe(t => topics.push(t));
    s.apply({ t: 'snapshot', state: snapshot([[1, 5, 'talk', 1, 'k1'], [5, 1, 'listen', 1, 'k1']]) });
    expect(topics).toEqual(['snapshot']);
    expect(s.ports).toHaveLength(128);
    expect(s.port(65)).toMatchObject({ facility: 1, local: 1, mnemonic: 'DIR', hasKeys: true });
    expect(s.route(1, 5)?.kind).toBe('talk');
    expect(s.isActive(1, 0)).toBe('latch');
    expect(s.xtOn(0, 1)).toBe(true);
    expect(s.relayClosed(1, 1)).toBe(true);
    expect(s.closedRelayCount()).toBe(1);
    expect(s.connectedLinkCount()).toBe(1);
    expect(s.extKeys.get(1)?.[0].targets).toEqual([65]);
    expect(s.facilityOf(65)).toBe(1);
    expect(s.gid(1, 3)).toBe(67);
    topics = [];
  });

  it('applies routes broadcasts and recomputes indices + tallies', () => {
    const s = new Store();
    s.apply({ t: 'snapshot', state: snapshot([[1, 5, 'talk', 1, 'k1']]) });
    const v = s.routesVersion;
    s.apply({ t: 'routes', routes: [[2, 6, 'grp', 1, 'g'], [7, 2, 'listen-lm', 0, 'lm'], [8, 3, 'listen', 1, 'l'],
      [41, 25, 'pgm', 0.1, 'ifb']], relays: [[0, 1, true]], active: [[2, 3, 'press']], xt: [] });
    expect(s.routesVersion).toBe(v + 1);
    expect(s.route(1, 5)).toBeUndefined();
    expect(s.byDst.get(6)?.map(r => r.src)).toEqual([2]);
    expect(s.bySrc.get(7)?.[0].kind).toBe('listen-lm');
    expect(s.getTally(2)).toEqual({ talking: true, talkedTo: false, listening: false });
    expect(s.getTally(6).talkedTo).toBe(true);
    expect(s.getTally(3).listening).toBe(true);
    expect(s.getTally(2).listening).toBe(false);        // muted listen/mute does not count
    expect(s.activeRouteCount()).toBe(3);
    expect(s.isActive(1, 0)).toBeNull();
    expect(s.isActive(2, 3)).toBe('press');
    expect(s.xtOn(0, 1)).toBe(false);
    expect(s.closedRelayCount()).toBe(1);
  });

  it('caps the event log and keeps station/error/links', () => {
    const s = new Store();
    s.apply({ t: 'snapshot', state: snapshot() });
    for (let i = 0; i < MAX_EVENTS + 5; i++) s.apply({ t: 'event', e: { id: i + 2, t: i, kind: 'key', text: 'x', facility: 0 } });
    expect(s.events).toHaveLength(MAX_EVENTS);
    expect(s.events[s.events.length - 1].id).toBe(MAX_EVENTS + 6);
    s.apply({ t: 'links', links: [] });
    expect(s.connectedLinkCount()).toBe(0);
    s.apply({ t: 'error', message: 'boom' });
    expect(s.lastError).toBe('boom');
  });

  it('searches ports by label, mnemonic and gid', () => {
    const s = new Store();
    s.apply({ t: 'snapshot', state: snapshot() });
    expect(s.searchPorts('dir').map(p => p.gid)).toEqual([1, 65]);
    expect(s.searchPorts('77').map(p => p.gid)).toEqual([77]);
    expect(s.searchPorts('F02 P0', 5)).toHaveLength(5);
  });
});
