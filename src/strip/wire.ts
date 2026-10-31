// The key strip <-> the page that frames it (the APK.audio OS footer): the one message pair, typed here and
// published with the sim so the framing side can read the same shapes. A field added keeps STRIP_WIRE;
// a field renamed, removed or reshaped bumps it.
export const STRIP_WIRE = 1;

/** strip -> frame: what the strip needs (its width) and shows (station, keys calling); `open` asks the frame to open the panel. */
export interface StripToFrame {
  source: 'microcom-strip'; v: number;
  width: number; station: string | null; calling: number;
  open?: 'panel'; p?: string;
}

/** frame -> strip: the room the footer gives the strip, px. `v` is optional: frames written before STRIP_WIRE send none. */
export interface FrameToStrip { source: 'apkos-footer'; v?: number; room: number }

export function stripMessage(width: number, station: string | null, calling: number, extra: Pick<StripToFrame, 'open' | 'p'> = {}): StripToFrame {
  return { source: 'microcom-strip', v: STRIP_WIRE, width, station, calling, ...extra };
}

/** A frame message this strip understands: the footer's source tag, a finite room, and no newer wire version. */
export function isFrameToStrip(d: unknown): d is FrameToStrip {
  const m = d as Partial<FrameToStrip> | null;
  return !!m && m.source === 'apkos-footer' && Number.isFinite(m.room) && (m.v === undefined || m.v === STRIP_WIRE);
}

/** The framing page's origin, so the strip posts to it rather than to '*': the browser's ancestor list,
 *  else the referrer (a framed page's referrer is its parent); '*' only when neither says. */
export function parentOrigin(ancestors: ArrayLike<string> | undefined, referrer: string): string {
  if (ancestors && ancestors.length && ancestors[0] !== 'null') return ancestors[0];
  try { const o = new URL(referrer).origin; if (o && o !== 'null') return o; } catch { /* no referrer */ }
  return '*';
}
