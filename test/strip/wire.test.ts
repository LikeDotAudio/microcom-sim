import { describe, expect, it } from 'vitest';
import { isFrameToStrip, parentOrigin, STRIP_WIRE, stripMessage } from '../../src/strip/wire';

describe('strip <-> footer wire', () => {
  it('stamps every strip message with the source tag and the wire version', () => {
    expect(stripMessage(300, 'PROD01 PNL02', 2)).toEqual({ source: 'microcom-strip', v: STRIP_WIRE, width: 300, station: 'PROD01 PNL02', calling: 2 });
    expect(stripMessage(10, null, 0, { open: 'panel', p: 'PROD01/PNL02' })).toMatchObject({ open: 'panel', p: 'PROD01/PNL02', v: STRIP_WIRE });
  });
  it('accepts footer messages with no version (older footers) or this version, nothing else', () => {
    expect(isFrameToStrip({ source: 'apkos-footer', room: 420 })).toBe(true);
    expect(isFrameToStrip({ source: 'apkos-footer', v: STRIP_WIRE, room: 420 })).toBe(true);
    expect(isFrameToStrip({ source: 'apkos-footer', v: STRIP_WIRE + 1, room: 420 })).toBe(false);
    expect(isFrameToStrip({ source: 'apkos-footer', room: 'wide' })).toBe(false);
    expect(isFrameToStrip({ source: 'someone-else', room: 420 })).toBe(false);
    expect(isFrameToStrip(null)).toBe(false);
  });
  it('posts to the framing origin when the browser says it, else "*"', () => {
    expect(parentOrigin(['https://os.example:8080'], '')).toBe('https://os.example:8080');
    expect(parentOrigin(undefined, 'http://127.0.0.1:8080/os/index.html')).toBe('http://127.0.0.1:8080');
    expect(parentOrigin(['null'], '')).toBe('*');
    expect(parentOrigin(undefined, '')).toBe('*');
  });
});
