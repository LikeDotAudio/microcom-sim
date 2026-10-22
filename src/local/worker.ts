// SharedWorker entry: ONE engine for every page of this site in this browser (matrix, panels,
// MicroCOM III, the MCOM.EXE emulator), so panel tabs hear each other.
import { servePorts, startHost } from './serve';

const attach = servePorts(startHost());
const g = self as unknown as { onconnect: ((e: MessageEvent) => void) | null; onmessage: ((e: MessageEvent) => void) | null };
g.onconnect = e => attach(e.ports[0]);
