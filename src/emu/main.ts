// The emulated-PC page: runs the visitor's own copy of MCOM.EXE (never hosted here) on the
// TypeScript 8086 with drive C: kept in this browser, COM1 to a simulated or in-browser frame.
import './emu.css';
import { VRAM } from './bios';
import { CP437, FROM_UNICODE } from './cp437';
import { Drive, type FileNode } from './drive';
import { browserKey, KEY_TOKENS, SCAN } from './keys';
import { hasEngineLink, type LinkChoice, openBackend } from './link';
import { realClock } from './machine';
import { Pc } from './pc';
import { Screen } from './screen';
import { autosave, loadDrive, saveDrive } from './store';

const KNOWN_SIZE = 198_167;                      // MCOM.EXE v3.20
const EXE_PATH = 'MICROCOM\\MCOM.EXE';
const SERIAL_KEEP = 4000;

// ---- tiny DOM helper -------------------------------------------------------------------------
type Child = Node | string | null | undefined | false;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const k of kids) if (k) e.append(k);
  return e;
}
const button = (label: string, onClick: () => void, cls = '') => {
  const b = el('button', { type: 'button', class: cls }, label);
  b.addEventListener('click', onClick);
  return b;
};
function download(name: string, data: Uint8Array | string, type = 'application/octet-stream') {
  const blob = new Blob([typeof data === 'string' ? data : data.slice()], { type });
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const cp437Text = (b: Uint8Array) => Array.from(b, c => (c === 10 || c === 13 || c === 9 ? String.fromCharCode(c) : CP437[c])).join('');

// ---- state -----------------------------------------------------------------------------------
let drive = new Drive();
let pc: Pc | null = null;
let runToken = 0;
const serialLines: string[] = [];
let printed: number[] = [];
const params = new URLSearchParams(location.search);

function initialLink(): LinkChoice {
  const c = (params.get('com1') ?? '').toLowerCase();
  const prod = /^prod(\d\d)$/.exec(c);
  if (prod && hasEngineLink) return { kind: 'engine', facility: Number(prod[1]) - 1 };
  if (c === 'none') return { kind: 'none' };
  if (c.startsWith('sim')) return { kind: 'sim', options: c.slice(4) };
  return hasEngineLink ? { kind: 'engine', facility: 0 } : { kind: 'sim' };
}
let link = initialLink();

// ---- layout ------------------------------------------------------------------------------------
const app = document.getElementById('app')!;
app.textContent = '';
const status = el('span', { class: 'pill' }, 'no program');
const header = el('header', { class: 'top' },
  el('div', { class: 'brand' }, 'MicroCOM II ', el('span', {}, 'Assignment Software')),
  el('div', { class: 'sub' }, 'the original DOS program on an emulated 8086 PC, in your browser'),
  el('div', { class: 'spacer' }), status);

const canvas = el('canvas', { tabindex: '0', 'aria-label': 'Emulated PC screen. Click, then type.' });
const screen = new Screen(canvas);
const overlay = el('div', { class: 'overlay', hidden: '' });
const typein = el('textarea', { class: 'typein', 'aria-label': 'Type into the PC', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' });
const monitor = el('div', { class: 'monitor' }, canvas, el('div', { class: 'focus-hint' }, 'click the screen to type'), overlay, typein);

const keyBar = el('div', { class: 'keys', role: 'toolbar', 'aria-label': 'PC keys' });
const BAR: [string, number][] = [
  ['F1', KEY_TOKENS.F1], ['F2', KEY_TOKENS.F2], ['F3', KEY_TOKENS.F3], ['F4', KEY_TOKENS.F4], ['F5', KEY_TOKENS.F5],
  ['F6', KEY_TOKENS.F6], ['F7', KEY_TOKENS.F7], ['F8', KEY_TOKENS.F8], ['F9', KEY_TOKENS.F9], ['F10', KEY_TOKENS.F10],
  ['⇧F6', KEY_TOKENS.SF6], ['⇧F7', KEY_TOKENS.SF7], ['Esc', KEY_TOKENS.ESC], ['Enter', KEY_TOKENS.ENTER],
  ['Tab', KEY_TOKENS.TAB], ['⇧Tab', KEY_TOKENS.STAB], ['←', KEY_TOKENS.LEFT], ['↑', KEY_TOKENS.UP], ['↓', KEY_TOKENS.DOWN],
  ['→', KEY_TOKENS.RIGHT], ['Home', KEY_TOKENS.HOME], ['End', KEY_TOKENS.END], ['PgUp', KEY_TOKENS.PGUP],
  ['PgDn', KEY_TOKENS.PGDN], ['Ins', KEY_TOKENS.INS], ['Del', KEY_TOKENS.DEL], ['Bksp', KEY_TOKENS.BKSP],
];
for (const [label, code] of BAR) {
  const b = el('button', { type: 'button', title: `Send ${label}` }, label);
  b.addEventListener('pointerdown', e => { e.preventDefault(); sendKey(code, label.startsWith('⇧') ? 0x02 : 0); });
  b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sendKey(code); } });
  keyBar.append(b);
}
const kbdBtn = el('button', { type: 'button', title: 'Show the on-screen keyboard (phones and tablets)' }, '⌨ Type');
kbdBtn.addEventListener('click', () => typein.focus());
keyBar.append(kbdBtn);

// COM1 panel
const linkSel = el('select', { 'aria-label': 'COM1' });
linkSel.append(el('option', { value: 'none' }, 'Not connected (OFF-LINE)'));
linkSel.append(el('option', { value: 'sim' }, 'Simulated frame (accepts every block)'));
linkSel.append(el('option', { value: 'sim:nak=3' }, 'Simulated frame, rejects every 3rd block'));
if (hasEngineLink) {
  for (let f = 0; f < 32; f++) {
    const n = String(f + 1).padStart(2, '0');
    linkSel.append(el('option', { value: `prod${n}` }, `In-browser matrix: frame PROD${n}`));
  }
}
const linkValue = (c: LinkChoice) => c.kind === 'engine' ? `prod${String(c.facility + 1).padStart(2, '0')}` : c.kind === 'sim' ? (c.options ? `sim:${c.options}` : 'sim') : 'none';
linkSel.value = linkValue(link);
linkSel.addEventListener('change', async () => {
  const v = linkSel.value;
  link = v === 'none' ? { kind: 'none' } : v.startsWith('sim') ? { kind: 'sim', options: v.slice(4) } : { kind: 'engine', facility: Number(v.slice(4)) - 1 };
  showLinkNotes();
  if (pc) {
    const old = pc.uarts[0].backend;
    pc.uarts[0].backend = await openBackend(link, realClock, matrixLog);
    old.close?.();
    pc.traffic.note(`COM1 now: ${pc.uarts[0].backend.name}`);
  }
});
const serialPre = el('pre', { class: 'log', 'aria-label': 'Serial traffic' });
const matrixPre = el('pre', { class: 'log', 'aria-label': 'Frame log' });
const matrixBox = el('div', {}, el('p', { class: 'small muted' }, 'What the frame did with each block:'), matrixPre);
const engineNote = el('p', { class: 'small' }, 'What the frame did with the blocks: see facility ',
  el('a', { href: './matrix.html', target: '_blank' }, 'on the Matrix page'), '.');
const showLinkNotes = () => { matrixBox.hidden = link.kind !== 'sim'; engineNote.hidden = link.kind !== 'engine'; };
const comPanel = el('section', { class: 'panel' },
  el('h2', {}, 'COM1: the cable to the frame', el('span', { class: 'spacer' }),
    button('Save log', () => download('serial.log', serialLines.join('\n') + '\n', 'text/plain'))),
  el('div', { class: 'row' }, linkSel),
  el('p', { class: 'small muted' }, '1200 baud, 8N1, through BIOS INT 14h. The frame sends ENQ while idle; each block is 35 bytes with one handshake. ',
    hasEngineLink ? 'The in-browser matrix is the same engine the Matrix and Panel pages show.' : ''),
  serialPre, matrixBox, engineNote);
showLinkNotes();

// Drive panel
const fileTable = el('table', { class: 'files' });
const fileInput = el('input', { type: 'file', multiple: '', hidden: '' }) as HTMLInputElement;
fileInput.addEventListener('change', () => { void addFiles(fileInput.files); fileInput.value = ''; });
const drivePanel = el('section', { class: 'panel' },
  el('h2', {}, 'Drive C:\\MICROCOM', el('span', { class: 'spacer' }),
    button('Add files…', () => fileInput.click()),
    button('Reset drive', () => void resetDrive())),
  el('p', { class: 'small muted' }, 'Kept only in this browser (IndexedDB). Setup files the program saves appear here; download them to keep them.'),
  fileTable, fileInput);

// Printer panel
const printPre = el('pre', { class: 'log', 'aria-label': 'Printer output' });
const printPanel = el('section', { class: 'panel' },
  el('h2', {}, 'LPT1: printer', el('span', { class: 'spacer' }),
    button('Save', () => download('printer.txt', cp437Text(Uint8Array.from(printed)), 'text/plain')),
    button('Clear', () => { printed = []; printPre.textContent = ''; })),
  el('p', { class: 'small muted' }, 'Reports printed from the program land here.'),
  printPre);

const controls = el('div', { class: 'row' },
  button('Restart PC', () => void boot()),
  el('span', { class: 'small muted' }, 'Keys: F1 help, F10 save, Esc back. If the browser keeps an F key, use Alt+1 … Alt+0 or the buttons.'));

const mainView = el('div', {}, monitor, keyBar, el('div', { class: 'grid' }, comPanel, drivePanel, printPanel), controls);

// Loader (no MCOM.EXE yet)
const drop = el('div', { class: 'drop' },
  el('p', {}, el('strong', {}, 'Drop MCOM.EXE here'), ' (and MCOM.HLP, MCOMFILE.* if you have them)'),
  button('Choose files…', () => fileInput.click(), 'primary'));
const loaderMsg = el('p', { class: 'err' });
const loader = el('section', { class: 'panel loader' },
  el('h1', {}, 'Run the MicroCOM II Assignment Software'),
  el('p', {}, 'This page is an 8086 PC with just enough DOS and BIOS to run MCOM.EXE v3.20, the 1993 program that ',
    'programmed Ward-Beck MicroCOM II intercom matrices. It runs the original machine code, unmodified.'),
  el('p', {}, 'The program is © 1991–93 Ward-Beck Systems (developed by Weitech Computer Solutions) and is ',
    el('strong', {}, 'not hosted here'), '. Load your own copy: it stays in this browser and is never uploaded.'),
  drop, loaderMsg,
  el('p', { class: 'small muted' }, 'Without MCOMFILE.* the program starts with New Configuration: press Enter four times to make a 48 x 48 setup.'));
for (const ev of ['dragenter', 'dragover'] as const) {
  document.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); });
}
document.addEventListener('dragleave', e => { if (e.target === document.documentElement || !e.relatedTarget) drop.classList.remove('over'); });
document.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); void addFiles(e.dataTransfer?.files ?? null); });

app.append(el('div', { class: 'wrap' }, header, loader, mainView));

// ---- files ---------------------------------------------------------------------------------------
function dosName(name: string): string | null {
  const up = name.toUpperCase().replace(/^.*[\\/]/, '');
  return /^[A-Z0-9_$~!#%&'(){}@^`-]{1,8}(\.[A-Z0-9_$~!#%&'(){}@^`-]{1,3})?$/.test(up) ? up : null;
}

async function addFiles(list: FileList | null) {
  if (!list || !list.length) return;
  const skipped: string[] = [];
  let gotExe = false;
  for (const f of Array.from(list)) {
    const name = dosName(f.name);
    if (!name) { skipped.push(f.name); continue; }
    const data = new Uint8Array(await f.arrayBuffer());
    if (name === 'MCOM.EXE') {
      if (data[0] !== 0x4D || data[1] !== 0x5A) { loaderMsg.textContent = 'That MCOM.EXE is not a DOS program (no MZ header).'; continue; }
      gotExe = true;
    }
    drive.writeFile(`MICROCOM\\${name}`, data, f.lastModified || Date.now());
  }
  renderFiles();
  await saveDrive(drive);
  if (skipped.length) loaderMsg.textContent = `Not an 8.3 DOS name, skipped: ${skipped.join(', ')}`;
  if (gotExe || (!pc && drive.readFile(EXE_PATH))) await boot();
}

function renderFiles() {
  fileTable.textContent = '';
  const dir = drive.resolve(['MICROCOM']);
  const files = dir && dir.kind === 'dir' ? [...dir.entries].filter(([, n]) => n.kind === 'file') as [string, FileNode][] : [];
  files.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (!files.length) fileTable.append(el('tr', {}, el('td', { class: 'muted' }, 'empty')));
  for (const [name, f] of files) {
    fileTable.append(el('tr', {},
      el('td', {}, name),
      el('td', { class: 'num' }, f.size.toLocaleString()),
      el('td', { class: 'num' }, new Date(f.mtime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })),
      el('td', { class: 'act' },
        button('Save', () => download(name, f.data.subarray(0, f.size))),
        ' ',
        button('Delete', () => { if (confirm(`Delete ${name} from drive C:?`)) { drive.remove(`MICROCOM\\${name}`); renderFiles(); } }))));
  }
}

async function resetDrive() {
  if (!confirm('Erase drive C: in this browser, including your MCOM.EXE and setups?')) return;
  stop();
  attachDrive(new Drive());
  await saveDrive(null);
  renderFiles();
  showLoader();
}

// ---- running ---------------------------------------------------------------------------------------
function setStatus(text: string, cls = '') { status.textContent = text; status.className = `pill ${cls}`; }

function showLoader() {
  loader.hidden = false;
  mainView.hidden = true;
  setStatus('no program');
}

function stop() {
  runToken++;
  pc?.uarts.forEach(u => u.backend.close?.());
  pc = null;
}

function addSerial(line: string) {
  serialLines.push(line);
  if (serialLines.length > SERIAL_KEEP) serialLines.splice(0, serialLines.length - SERIAL_KEEP);
  serialDirty = true;
}
const matrixLines: string[] = [];
function matrixLog(line: string) {
  matrixLines.push(line);
  if (matrixLines.length > 500) matrixLines.shift();
  matrixDirty = true;
}
let serialDirty = false, matrixDirty = false, printDirty = false;

function showOverlay(...content: Child[]) {
  overlay.textContent = '';
  overlay.append(...content.filter(Boolean) as (Node | string)[]);
  overlay.hidden = false;
}

async function boot() {
  stop();
  const exe = drive.readFile(EXE_PATH);
  if (!exe) { showLoader(); return; }
  loader.hidden = true;
  mainView.hidden = false;
  overlay.hidden = true;
  serialLines.length = 0;
  const token = runToken;
  const com1 = await openBackend(link, realClock, matrixLog);
  if (token !== runToken) { com1.close?.(); return; }
  pc = new Pc({
    drive, exe, clock: realClock, com1,
    log: msg => { if (/unhandled|unimplemented|fault/i.test(msg)) console.warn('[pc]', msg); },
    serialLog: addSerial,
    printer: d => { printed.push(...d); printDirty = true; },
    shell: () => setStatus('DOS Shell is not available here', 'err'),
  });
  setStatus(exe.length === KNOWN_SIZE ? 'running MCOM.EXE v3.20' : `running MCOM.EXE (${exe.length.toLocaleString()} bytes; v3.20 is ${KNOWN_SIZE.toLocaleString()})`, 'on');
  canvas.focus();
  run(token);
}

const channel = new MessageChannel();
let pendingRun: (() => void) | null = null;
channel.port1.onmessage = () => { const f = pendingRun; pendingRun = null; f?.(); };
const soon = (f: () => void) => { pendingRun = f; channel.port2.postMessage(0); };

function run(token: number) {
  if (token !== runToken || !pc) return;
  const p = pc;
  const t0 = performance.now();
  try {
    while (performance.now() - t0 < 12) {
      if (!p.step(100_000)) {
        setStatus(`MCOM.EXE exited (code ${p.exitCode})`);
        showOverlay(el('p', {}, 'The program has quit.'), button('Start it again', () => void boot(), 'primary'));
        return;
      }
      if (p.waiting) break;
    }
  } catch (e) {
    console.error(e);
    setStatus('emulation stopped', 'err');
    showOverlay(el('p', {}, `The emulated PC stopped: ${(e as Error).message}`), button('Restart PC', () => void boot(), 'primary'));
    return;
  }
  if (p.waiting) setTimeout(() => run(token), 5);
  else soon(() => run(token));
}

// ---- drawing ---------------------------------------------------------------------------------------
function frame(t: number) {
  if (pc) {
    const m = pc.m;
    screen.draw({
      vram: m.cpu.mem.subarray(VRAM, VRAM + 4000),
      cursor: pc.bios.cursor, cursorVisible: !pc.bios.cursorHidden, blink: pc.bios.blink,
    }, Math.floor(t / 267) % 2);
  }
  if (serialDirty) { serialDirty = false; pinBottom(serialPre, serialLines.slice(-400).join('\n')); }
  if (matrixDirty) { matrixDirty = false; pinBottom(matrixPre, matrixLines.slice(-200).join('\n')); }
  if (printDirty) { printDirty = false; pinBottom(printPre, cp437Text(Uint8Array.from(printed.slice(-20000)))); }
  requestAnimationFrame(frame);
}
function pinBottom(pre: HTMLElement, text: string) {
  const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
  pre.textContent = text;
  if (atEnd) pre.scrollTop = pre.scrollHeight;
}
requestAnimationFrame(frame);

// ---- keyboard ----------------------------------------------------------------------------------------
function sendKey(code: number, flags = 0) {
  if (!pc) return;
  pc.bios.pushKey(code, flags);
  if (document.activeElement !== typein) canvas.focus();
}

canvas.addEventListener('keydown', e => {
  if (e.isComposing) return;
  const k = browserKey(e);
  if (!k) return;
  e.preventDefault();
  sendKey(k[0], k[1]);
});
canvas.addEventListener('pointerdown', () => canvas.focus());

// soft keyboards: characters arrive as input events on the hidden textarea
typein.addEventListener('input', () => {
  for (const ch of typein.value) {
    const code = ch === '\n' ? KEY_TOKENS.ENTER : (SCAN[ch.toLowerCase()] ?? 0) << 8 | (FROM_UNICODE.get(ch) ?? ch.charCodeAt(0) & 0xFF);
    sendKey(code);
  }
  typein.value = '';
});
typein.addEventListener('keydown', e => {
  if (e.key === 'Backspace' || e.key === 'Enter' || e.key.startsWith('Arrow') || e.key === 'Escape' || e.key === 'Tab') {
    const k = browserKey(e);
    if (k) { e.preventDefault(); sendKey(k[0], k[1]); }
  }
});

// ---- start --------------------------------------------------------------------------------------------
let filesDirty = false;
function attachDrive(d: Drive) {
  drive = d;
  autosave(drive);
  const save = drive.onChange;
  drive.onChange = () => { save(); filesDirty = true; };
}
setInterval(() => { if (filesDirty) { filesDirty = false; renderFiles(); } }, 1000);

(async () => {
  attachDrive((await loadDrive()) ?? new Drive());
  renderFiles();
  if (drive.readFile(EXE_PATH)) await boot();
  else showLoader();
})();
