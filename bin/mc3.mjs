#!/usr/bin/env node
// MicroCOM III Assignment Software in a Linux terminal.
// Runs the TypeScript core directly with Node 24's built-in type stripping (no build step, no
// dependencies): a resolve hook maps the extensionless imports used by Vite to the .ts files.
//
//   node bin/mc3.mjs [--url ws://127.0.0.1:8048/ws] [--prod 30] [--print-dir DIR]
//   Ctrl-] quits at any time. Alt-1..Alt-0 = F1..F10 if the terminal grabs function keys.
import { registerHooks } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if ((spec.startsWith('./') || spec.startsWith('../')) && !/\.[cm]?[jt]s$/.test(spec)) return next(`${spec}.ts`, ctx);
      throw e;
    }
  },
});

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
if (args.includes('-h') || args.includes('--help')) {
  console.log('usage: mc3 [--url ws://127.0.0.1:8048/ws] [--prod N] [--print-dir DIR]');
  process.exit(0);
}
const url = opt('--url', process.env.MC3_URL ?? 'ws://127.0.0.1:8048/ws');
const prod = Number(opt('--prod', process.env.MC3_PROD ?? '1')) - 1;
const printDir = resolve(opt('--print-dir', process.cwd()));

const { App } = await import('../src/mc3/core/app.ts');
const { AnsiRenderer, parseInput, incomplete, QUIT } = await import('../src/mc3/ansi.ts');

const out = process.stdout;
const inp = process.stdin;
const renderer = new AnsiRenderer();
let done = false;

const app = new App({
  url,
  factory: u => new WebSocket(u),
  server: url.replace(/^wss?:\/\//, '').replace(/\/ws$/, ''),
  production: Number.isFinite(prod) ? prod : 0,
  host: {
    beep: () => out.write('\x07'),
    print: (name, text) => {
      const path = join(printDir, name);
      writeFileSync(path, text, 'latin1');
      return path;
    },
    quit: () => finish(0),
  },
});

function draw() {
  const s = renderer.frame(app.rt.screen);
  if (s) out.write(s);
}

function finish(code) {
  if (done) return;
  done = true;
  app.rt.stop();
  out.write('\x1b[0m\x1b[0 q\x1b[?7h\x1b[?25h\x1b[2J\x1b[H\x1b[?1049l');
  if (inp.isTTY) inp.setRawMode(false);
  inp.pause();
  if (code === 0) console.log('MicroCOM III terminated.');
  process.exit(code);
}

if (out.columns && (out.columns < 80 || out.rows < 25)) {
  console.error(`MicroCOM III needs an 80x25 terminal (this one is ${out.columns}x${out.rows}).`);
}
out.write('\x1b[?1049h\x1b[?7l\x1b[?25l\x1b[2J');
if (inp.isTTY) inp.setRawMode(true);
inp.setEncoding('utf8');
let buf = '';
let timer = null;
const flush = () => {
  timer = null;
  const keys = parseInput(buf);
  buf = '';
  for (const k of keys) {
    if (k === QUIT) { finish(0); return; }
    app.rt.push(k);
  }
};
inp.on('data', d => {
  buf += d;
  if (timer) clearTimeout(timer);
  if (incomplete(buf)) timer = setTimeout(flush, 40);
  else flush();
});
inp.on('end', () => finish(0));
out.on('resize', () => { renderer.invalidate(); out.write('\x1b[2J'); draw(); });
process.on('SIGTERM', () => finish(0));
process.on('SIGHUP', () => finish(0));

app.rt.screen.onChange(draw);
app.rt.start();
draw();
app.run().then(() => finish(0), e => {
  out.write('\x1b[0m\x1b[?1049l');
  console.error(e);
  finish(1);
});
