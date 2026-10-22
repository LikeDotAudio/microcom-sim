// COM1 back-ends for the page: nothing, the simple simulated frame (sim.ts), or a facility of the
// in-browser engine through src/local/frameLink.ts (when this build has it).
import type { Clock } from './machine';
import { MatrixSim } from './sim';
import { type Backend, MSR_CTS, MSR_DCD, MSR_DSR, nullBackend } from './uart';

interface FrameLink { send(bytes: Uint8Array): void; onData(cb: (b: Uint8Array) => void): void; close(): void }
type FrameLinkModule = { openFrameLink(facility: number): FrameLink };

// Resolved at build time: empty when src/local/frameLink.ts is not part of this build.
const linkModules = import.meta.glob<FrameLinkModule>('../local/frameLink.ts');
const linkLoader = Object.values(linkModules)[0];

export const hasEngineLink = !!linkLoader;

export type LinkChoice = { kind: 'none' } | { kind: 'sim'; options?: string } | { kind: 'engine'; facility: number };

class EngineBackend implements Backend {
  name: string;
  private rx: number[] = [];
  constructor(private readonly link: FrameLink, facility: number) {
    this.name = `frame PROD${String(facility + 1).padStart(2, '0')}`;
    link.onData(b => { this.rx.push(...b); });
  }
  write(data: Uint8Array) { this.link.send(data); }
  read() { const d = Uint8Array.from(this.rx); this.rx = []; return d; }
  modem() { return MSR_CTS | MSR_DSR | MSR_DCD; }
  close() { this.link.close(); }
}

export async function openBackend(choice: LinkChoice, clock: Clock, log: (line: string) => void): Promise<Backend> {
  if (choice.kind === 'sim') return new MatrixSim(clock, choice.options ?? '', log);
  if (choice.kind === 'engine' && linkLoader) {
    const mod = await linkLoader();
    return new EngineBackend(mod.openFrameLink(choice.facility), choice.facility);
  }
  return nullBackend();
}
