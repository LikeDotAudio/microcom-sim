// MicroCOM III Assignment Software: startup, title screen, status panel and the main menu loop
// (MCOM.EXE 1000:0000 / 00f0 / 0354), extended to the 2048-port virtual matrix.
import { clock, drawStatusPanel, notYet, refreshStatus, type Ctx } from './ctx';
import { EngineClient, type WsFactory } from './engine';
import { HELP } from './help';
import { K } from './keys';
import { Workspace } from './model';
import { Runtime, type Host } from './runtime';
import { assignmentMenu } from './screens/assign';
import { callArray, cameraArray, epcEditor, ifbEditor, relayEditor } from './screens/arrays';
import { matrixIndexTable } from './screens/indexTable';
import { keypadPrefix } from './screens/keypad';
import { overlayDefinition } from './screens/overlay';
import { peoplePlaces, productionSetup } from './screens/people';
import { copyProduction, printerSetup, selectProduction } from './screens/prodsel';
import { dataLinkTest, transfer } from './screens/transfer';
import { clearMsg, confirm, helpWindow, menuBar, wopen, type BarItem } from './tcxl';

export const VERSION = '4.00';

export interface AppOptions {
  url: string;
  factory: WsFactory;
  host?: Host;
  /** Shown in the status panel as "Matrix Engine:". */
  server?: string;
  /** 0-based production to start with. */
  production?: number;
  runtime?: Runtime;
}

const LOGO = [
  '█▀█▀█ ▀           █▀▀ █▀█ █▀█▀█  █ █ █',
  '█ █ █ █ █▀ █▀ █▀█ █   █ █ █ █ █  █ █ █',
  '█ █ █ █ █▄ █  █▄█ █▄▄ █▄█ █ █ █  █ █ █',
];

export class App {
  readonly rt: Runtime;
  readonly eng: EngineClient;
  readonly ws: Workspace;
  readonly ctx: Ctx;
  private inMenu = false;
  private quit = false;

  constructor(o: AppOptions) {
    this.rt = o.runtime ?? new Runtime(o.host ?? {});
    if (o.host) this.rt.host = o.host;
    this.eng = new EngineClient(o.url, o.factory);
    this.ws = new Workspace(this.eng);
    this.ws.current = Math.max(0, Math.min(31, o.production ?? 0));
    this.ctx = { rt: this.rt, eng: this.eng, ws: this.ws, printer: { type: 0 }, server: o.server ?? o.url };
  }

  /** Title screen + status panel (1000:00f0). */
  drawTitle() {
    const s = this.rt.screen;
    s.fill(0, 0, 24, 79, 0x70);
    s.put(1, 0, 0x70, '▀'.repeat(80));
    s.put(4, 21, 0x74, LOGO[0]);
    s.put(5, 21, 0x70, LOGO[1]);
    s.put(6, 21, 0x70, LOGO[2]);
    s.put(8, 20, 0x74, 'C O M M U N I C A T I O N S  S Y S T E M');
    s.put(9, 35, 0x70, 'Release 4.0');
    s.put(11, 19, 0x78, '2048 Port Virtual Matrix - 32 Productions');
    drawStatusPanel(this.ctx);
  }

  /** About box (Alt-V, 1000:0b50). */
  async about() {
    const w = wopen(this.rt, 17, 10, 20, 43, 5, 0x2f, 0x2f);
    w.prints(0, 1, 0x24, 'MicroCOM III Assignment Software');
    w.prints(1, 10, 0x2f, `Version ${VERSION}`);
    w.prints(2, 1, 0x2f, 'Developed for WARD-BECK SYSTEMS');
    w.prints(3, 2, 0x2f, 'by WEITECH Computer Solutions');
    await this.rt.waitKey(1000);
    w.close();
  }

  private act(fn: () => Promise<unknown>, close = false): () => Promise<void | 'close'> {
    return async () => {
      this.inMenu = false;
      this.rt.idle = null;
      this.rt.onKey(K.ALT_P, null);
      try {
        await fn();
      } finally {
        clearMsg(this.rt);
        this.rt.screen.hideCursor();
        refreshStatus(this.ctx);
        this.enterMenu();
      }
      return close || this.quit ? 'close' : undefined;
    };
  }

  private enterMenu() {
    this.inMenu = true;
    this.rt.idle = () => clock(this.ctx);
    this.rt.onKey(K.ALT_P, async () => {
      this.inMenu = false;
      try { await selectProduction(this.ctx); } finally { refreshStatus(this.ctx); this.inMenu = true; }
    });
  }

  private menu(): BarItem[] {
    const c = this.ctx;
    const a = (fn: () => Promise<unknown>, close = false) => this.act(fn, close);
    return [
      { text: 'Define System', col: 3, hot: 0, help: 1, pull: { srow: 1, scol: 3, erow: 10, ecol: 25, barwidth: 21, init: 2, items: [
        { text: 'Matrix Index Table', hot: 0, help: 2, run: a(() => matrixIndexTable(c)) },
        { text: 'Keypad Prefix Codes', hot: 0, help: 3, run: a(() => keypadPrefix(c)) },
        { text: 'Overlay Definition', hot: 0, run: a(() => overlayDefinition(c)) },
        { text: 'IFB/PGM Sound', hot: 0, run: a(() => ifbEditor(c)) },
        { text: 'Camera Array', hot: 0, run: a(() => cameraArray(c)) },
        { text: 'Electronic Pegboard', hot: 0, run: a(() => epcEditor(c)) },
        { text: 'Call Array         ', hot: 5, run: a(() => callArray(c)) },
        { text: 'Relay Control      ', hot: 0, run: a(() => relayEditor(c)) },
      ] } },
      { text: 'Data Transfer', col: 20, hot: 5, help: 6, pull: { srow: 1, scol: 20, erow: 12, ecol: 42, barwidth: 22, init: 1, items: [
        { text: 'Index & Keypad      ', hot: 0, help: 6, run: a(() => transfer(c, 'index')) },
        { text: 'Matrix Index Overlay', hot: 0, help: 6, run: a(() => transfer(c, 'overlay')) },
        { text: 'Phantom Overlay     ', hot: 0, help: 6, run: a(() => transfer(c, 'phantom')) },
        { text: 'IFB/PGM Sound       ', hot: 1, help: 6, run: a(() => transfer(c, 'ifb')) },
        { text: 'Camera Array        ', hot: 0, help: 6, run: a(() => transfer(c, 'camera')) },
        { text: 'Electronic Pegboard ', hot: 0, help: 6, run: a(() => transfer(c, 'epc')) },
        { text: 'Call Array          ', hot: 5, help: 6, run: a(() => transfer(c, 'call')) },
        { text: 'Relay Control       ', hot: 0, help: 6, run: a(() => transfer(c, 'relay')) },
        { text: 'Terminal Assignment ', hot: 0, help: 6, run: a(() => transfer(c, 'terminal')) },
        { text: 'Whole Production    ', hot: 0, help: 6, run: a(() => transfer(c, 'all')) },
      ] } },
      { text: 'Terminal Assignments', col: 36, hot: 9, help: 1, pull: { srow: 1, scol: 36, erow: 7, ecol: 58, barwidth: 21, init: 1, items: [
        { text: 'Select Definition  ', hot: 0, help: 7, run: a(() => selectProduction(c)) },
        { text: 'Assignment Edit    ', hot: 11, help: 4, run: a(() => assignmentMenu(c, 1)) },
        { text: 'Terminal Group Edit', hot: 9, help: 8, run: a(() => assignmentMenu(c, 2)) },
        { text: 'Transfer Assignment', hot: 9, help: 6, run: a(() => assignmentMenu(c, 3)) },
        { text: 'Transfer Group     ', hot: 0, help: 6, run: a(() => assignmentMenu(c, 4)) },
      ] } },
      { text: 'Utilities', col: 60, hot: 0, help: 1, pull: { srow: 1, scol: 57, erow: 8, ecol: 77, barwidth: 20, init: 0, items: [
        { text: 'Select Production', hot: 0, help: 7, run: a(() => selectProduction(c), true) },
        { text: 'Production Setup ', hot: 0, run: a(() => productionSetup(c), true) },
        { text: 'People & Places  ', hot: 4, help: 5, run: a(() => peoplePlaces(c)) },
        { text: 'Copy Production  ', hot: 0, run: a(() => copyProduction(c)) },
        { text: 'Printer Setup    ', hot: 1, run: a(() => printerSetup(c)) },
        { text: 'Data Link Test   ', hot: 10, run: a(() => dataLinkTest(c)) },
      ] } },
      { text: 'Quit', col: 72, hot: 0, help: 1, pull: { srow: 1, scol: 72, erow: 4, ecol: 77, barwidth: 5, init: 0, items: [
        { text: 'No ', hot: 0, close: true },
        { text: 'Yes', hot: 0, run: a(() => this.confirmQuit()) },
      ] } },
    ];
  }

  private async confirmQuit() {
    const dirty = this.ws.dirtyProductions();
    if (dirty.length) {
      const names = dirty.map(f => this.eng.fname(f)).join(' ');
      if (!await confirm(this.rt, 1, `Changes for ${names} not applied! <ENTER> quits anyway, any other key returns.`.slice(0, 79))) return;
    }
    this.quit = true;
  }

  /** Main program (1000:0000). Resolves when the user quits. */
  async run(): Promise<void> {
    const { rt } = this;
    rt.onKey(K.F1, async () => helpWindow(rt, HELP[rt.helpCat] ?? null, rt.helpCat));
    rt.onKey(K.ALT_V, async () => this.about());
    rt.screen.hideCursor();
    this.drawTitle();
    this.eng.on(() => { if (this.inMenu) refreshStatus(this.ctx); });
    this.eng.connect();
    while (!this.quit) {
      refreshStatus(this.ctx);
      this.enterMenu();
      await menuBar(rt, this.menu(), 2);
    }
    this.inMenu = false;
    rt.idle = null;
    this.eng.close();
    rt.host.quit?.();
  }
}

export { notYet };
