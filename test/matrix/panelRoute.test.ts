import { describe, expect, it } from 'vitest';
import { panelPath, resolvePanel } from '../../src/panel/route';
import type { Port } from '../../src/matrix/types';

const port = (gid: number, label: string, mnemonic: string): Port => ({
  gid, label, mnemonic, kind: 'panel', overlay: '', termType: '1', hasKeys: true,
  facility: Math.floor((gid - 1) / 64), local: (gid - 1) % 64 + 1,
});
const ports = [port(1, 'F01 PNL01', 'DIR '), port(2, 'F01 PNL02', 'PRD '), port(1985, 'F32 PNL01', 'DIR ')];

describe('panel URLs', () => {
  it('builds readable paths', () => expect(panelPath(ports[2])).toBe('/panel/F32/PNL01'));

  it('resolves label, mnemonic, bus number and gid forms', () => {
    expect(resolvePanel('/panel/F01/PNL02', ports)).toEqual({ kind: 'panel', gid: 2 });
    expect(resolvePanel('/panel/f32/dir', ports)).toEqual({ kind: 'panel', gid: 1985 });
    expect(resolvePanel('/panel/32/1', ports)).toEqual({ kind: 'panel', gid: 1985 });
    expect(resolvePanel('/panel/1985', ports)).toEqual({ kind: 'panel', gid: 1985 });
  });

  it('routes the index and reports unknown panels', () => {
    expect(resolvePanel('/panels', ports)).toEqual({ kind: 'index' });
    expect(resolvePanel('/panel/', ports)).toEqual({ kind: 'index' });
    expect(resolvePanel('/panel/F09/NOPE', ports).kind).toBe('unknown');
    expect(resolvePanel('/panel/9999', ports).kind).toBe('unknown');
  });
});
