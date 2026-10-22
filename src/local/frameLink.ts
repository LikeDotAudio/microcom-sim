// Byte-stream equivalent of the TCP 7000+f frame link (mcommatrix/link.py): the frame side of the
// MicroCOM II serial protocol, running in the browser's local engine (SharedWorker). The in-browser
// 8086 (src/emu) plugs its COM1 into this: what the PC transmits goes to send(), what the frame
// answers (ENQ every 400 ms while idle, SYN, ACK, CR, link-test echo) arrives at onData callbacks.
// Bytes are delivered as they come; serial pacing (1200 baud) is up to the caller.
import { openFrameLinkImpl } from './socket';

export interface FrameLink {
  /** Bytes from the PC (MCOM.EXE's COM1 transmit) to the frame. */
  send(bytes: Uint8Array): void;
  /** Bytes from the frame (ENQ, SYN, ACK, CR) to the PC. */
  onData(cb: (b: Uint8Array) => void): void;
  close(): void;
}

/** Connect to facility `facility`'s frame (0-based: PROD01 = 0). */
export function openFrameLink(facility: number): FrameLink {
  return openFrameLinkImpl(facility);
}
