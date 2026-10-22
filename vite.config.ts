import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const ENGINE = '127.0.0.1:8048';

// Two builds: `vite build` -> dist/ for the Python engine (mcommatrix/server.py serves /panel/F01/PNL01
// and /assets/ from the root, so assets are absolute), and `vite build --mode static` -> dist-static/ for
// a static host such as GitHub Pages under any sub-path (relative assets; the engine runs in the browser).
export default defineConfig(({ mode }) => ({
  base: mode === 'static' ? './' : '/',
  worker: { format: 'es' },
  build: {
    outDir: mode === 'static' ? 'dist-static' : 'dist',
    // (`rolldownOptions` is Vite 8's name for the deprecated `rollupOptions`.)
    rolldownOptions: {
      input: {
        matrix: resolve(import.meta.dirname, 'matrix.html'),
        panel: resolve(import.meta.dirname, 'panel.html'),
        mc3: resolve(import.meta.dirname, 'mc3.html'),
        emu: resolve(import.meta.dirname, 'emu.html'),
        // the landing page only on the static site (the Python server has its own / route)
        ...(mode === 'static' ? { index: resolve(import.meta.dirname, 'index.html') } : {}),
      },
    },
  },
  server: {
    proxy: {
      '/ws': { target: `ws://${ENGINE}`, ws: true },
      '/api': { target: `http://${ENGINE}` },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
}));
