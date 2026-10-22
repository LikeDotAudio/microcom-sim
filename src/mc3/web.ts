// MicroCOM III in the browser: canvas text-mode screen, PC keyboard mapping, speaker, printer = download.
import { CanvasRenderer } from './canvas';
import { App } from './core/app';
import { keyOf } from './webkeys';
import { openSocket, resolveEngine } from '../local/mode';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const hint = document.getElementById('hint') as HTMLElement;

const params = new URLSearchParams(location.search);
const stored = (() => { try { return localStorage.getItem('mc3.prod'); } catch { return null; } })();
const prod = Number(params.get('prod') ?? stored ?? '1') - 1;
const wsUrl = params.get('ws') ?? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

// ---- speaker ---------------------------------------------------------------------------------
let audio: AudioContext | null = null;
function beep() {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const gain = audio.createGain();
    o.type = 'square';
    o.frequency.value = 1193180 / 5000;
    gain.gain.value = 0.05;
    o.connect(gain).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.11);
  } catch { /* no audio */ }
}

// ---- printer ---------------------------------------------------------------------------------
function download(name: string, text: string): string {
  const bytes = Uint8Array.from(text, ch => ch.charCodeAt(0) & 0xff);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return `${name} (download)`;
}

const app = new App({
  url: wsUrl,
  factory: u => openSocket(u) as never,
  server: location.host || 'engine',
  production: Number.isFinite(prod) ? prod : 0,
  host: {
    beep,
    print: download,
    quit: () => {
      const s = app.rt.screen;
      s.fill(0, 0, 24, 79, 0x07);
      s.put(0, 0, 0x07, 'MicroCOM III terminated.');
      s.put(2, 0, 0x07, 'Press any key to restart.');
      s.setCursor(3, 0, true);
      addEventListener('keydown', () => location.reload(), { once: true });
    },
  },
});
(window as unknown as { mc3: App }).mc3 = app;

const renderer = new CanvasRenderer(canvas, app.rt.screen);
const fit = () => renderer.resize(window.innerWidth - 16, window.innerHeight - 40);
addEventListener('resize', fit);
fit();
// a real VGA font may arrive after the first paint
void document.fonts?.ready.then(() => fit());

// remember the active production between visits
let lastProd = app.ws.current;
app.rt.screen.onChange(() => {
  if (app.ws.current !== lastProd) {
    lastProd = app.ws.current;
    try { localStorage.setItem('mc3.prod', String(lastProd + 1)); } catch { /* private mode */ }
  }
});

// ---- keyboard --------------------------------------------------------------------------------
canvas.addEventListener('keydown', e => {
  const k = keyOf(e);
  if (k === null) return;
  e.preventDefault();
  e.stopPropagation();
  app.rt.push(k);
});
canvas.addEventListener('paste', e => {
  const t = e.clipboardData?.getData('text') ?? '';
  e.preventDefault();
  const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
  for (const s of seg.segment(t.replace(/[\r\n]+/g, ''))) app.rt.push(s.segment);
});
// keep F1 (browser help) and F5 (reload) etc. from leaking while the screen has focus
addEventListener('keydown', e => { if (document.activeElement === canvas && /^F\d+$/.test(e.key)) e.preventDefault(); });
addEventListener('help', e => e.preventDefault());

const focusHint = () => { hint.textContent = document.activeElement === canvas ? 'Alt+1..Alt+0 = F1..F10   Shift+F6/F7   Ctrl+Enter' : 'Click the screen to type'; };
canvas.addEventListener('focus', focusHint);
canvas.addEventListener('blur', focusHint);
canvas.addEventListener('mousedown', () => canvas.focus());
canvas.focus();
focusHint();

app.rt.start();
void resolveEngine().then(() => app.run());
