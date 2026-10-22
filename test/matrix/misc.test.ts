import { describe, expect, it } from 'vitest';
import { epcTypeName, ifbState } from '../../src/matrix/facility';
import { labelForKeyboard } from '../../src/matrix/keypanel';
import { filterEvents } from '../../src/matrix/log';
import { Store } from '../../src/matrix/store';
import { snapshot } from './fixtures';

describe('misc pure helpers', () => {
  it('maps keyboard keys to panel key labels', () => {
    expect(['1', '9', '0', 'a', 'D', 'e', 'x'].map(labelForKeyboard)).toEqual(['1', '9', '10', 'A', 'D', null, null]);
  });

  it('decodes EPC types', () => {
    const e = (type: number, ext = 1) => epcTypeName({ in: 1, out: 2, type, ext, comment: '' });
    expect([e(0x40), e(0x41), e(0x42, 3), e(0xc4), e(0x44), e(0xa4, 12)]).toEqual(['PERM', 'INHIBIT', 'XT03', 'EV01 TL', 'EV01 T', 'EV12 LM']);
  });

  it('derives live IFB state from the program route gain', () => {
    const s = new Store();
    s.apply({ t: 'snapshot', state: snapshot([[41, 25, 'pgm', 1, ''], [42, 26, 'pgm', 0.1, '']]) });
    expect([ifbState(s, 41, 25), ifbState(s, 42, 26), ifbState(s, 43, 27)]).toEqual(['normal', 'interrupted', 'off']);
  });

  it('filters events newest first', () => {
    const ev = [1, 2, 3, 4].map(i => ({ id: i, t: i, kind: i % 2 ? 'key' : 'xt', text: '', facility: i < 3 ? 0 : 1 }));
    expect(filterEvents(ev, '', -1).map(e => e.id)).toEqual([4, 3, 2, 1]);
    expect(filterEvents(ev, 'key', -1).map(e => e.id)).toEqual([3, 1]);
    expect(filterEvents(ev, '', 1).map(e => e.id)).toEqual([4, 3]);
  });
});
