// The "PC" the app runs on: the screen, a keyboard queue with TCXL getxch semantics (global hot keys such
// as F1 help and Alt-V are dispatched inside every key wait), timers, the speaker and the printer.
import type { Key } from './keys';
import { Screen } from './screen';

export interface Host {
  /** PC speaker beep (5000,2) ≈ 239 Hz, 110 ms. */
  beep?(): void;
  /** Deliver a printout / exported text. Returns where it went (file name), shown to the user. */
  print?(name: string, text: string): string | Promise<string>;
  /** Called when the program quits. */
  quit?(): void;
}

type HotKey = (k: Key) => Promise<void>;

export class Runtime {
  readonly screen = new Screen();
  host: Host;
  /** Called about once a second while the app waits for a key (main-menu clock). */
  idle: (() => void) | null = null;
  /** Current help category (TCXL whelpcat). */
  helpCat = 1;
  private queue: Key[] = [];
  private waiters: ((k: Key | null) => void)[] = [];
  private hot = new Map<Key, HotKey>();
  private inHot = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Clock source (tests pin it). */
  now: () => Date = () => new Date();
  /** Multiplier for sleeps and key-wait timeouts (tests run with a small value). */
  timeScale = 1;
  /** True while the program waits for a key with no timeout (tests use it to settle). */
  blocked = false;

  constructor(host: Host = {}) {
    this.host = host;
  }

  /** Start the 1 s idle tick (front ends call this; tests don't). */
  start() {
    if (!this.timer) this.timer = setInterval(() => this.idle?.(), 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const w of this.waiters.splice(0)) w(null);
  }

  /** Feed a key from the front end. */
  push(k: Key) {
    const w = this.waiters.shift();
    if (w) w(k);
    else if (this.queue.length < 64) this.queue.push(k);
  }

  /** Register a global hot key (TCXL setonkey / help key). */
  onKey(k: Key, fn: HotKey | null) {
    if (fn) this.hot.set(k, fn);
    else this.hot.delete(k);
  }

  private raw(ms: number): Promise<Key | null> {
    const k = this.queue.shift();
    if (k !== undefined) return Promise.resolve(k);
    if (ms === 0) return Promise.resolve(null);
    if (ms > 0) ms = Math.max(1, Math.round(ms * this.timeScale));
    return new Promise(resolve => {
      let done = false;
      if (ms < 0) this.blocked = true;
      const w = (key: Key | null) => { if (!done) { done = true; if (ms < 0) this.blocked = false; resolve(key); } };
      this.waiters.push(w);
      if (ms > 0) {
        setTimeout(() => {
          if (done) return;
          done = true;
          const i = this.waiters.indexOf(w);
          if (i >= 0) this.waiters.splice(i, 1);
          resolve(null);
        }, ms);
      }
    });
  }

  /** Wait for a key (forever). Hot keys are handled here and never returned. */
  async getKey(): Promise<Key> {
    for (;;) {
      const k = await this.raw(-1);
      if (k === null) throw new Quit();
      if (await this.dispatchHot(k)) continue;
      return k;
    }
  }

  /** TCXL waitkeyt: wait up to ms for a key; null on timeout. A key pressed during the wait is consumed.
   *  (Unlike TCXL, type-ahead is not flushed: it ends the wait at once and stays queued, so scripted
   *  key sequences are never lost.) */
  async waitKey(ms: number): Promise<Key | null> {
    if (this.queue.length) return null;
    return this.raw(ms);
  }

  /** Discard type-ahead. */
  flush() { this.queue.length = 0; }

  /** True if a key is waiting (kbhit). */
  get keyReady(): boolean { return this.queue.length > 0; }

  private async dispatchHot(k: Key): Promise<boolean> {
    const fn = this.hot.get(k);
    if (!fn || this.inHot) return false;
    this.inHot = true;
    try { await fn(k); } finally { this.inHot = false; }
    return true;
  }

  sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms * this.timeScale));
  }

  beep() { this.host.beep?.(); }
}

/** Thrown out of getKey() when the runtime is stopped (front end closed). */
export class Quit extends Error {
  constructor() { super('quit'); }
}
