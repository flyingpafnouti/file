import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function ffmpegAssets(): Plugin {
  const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];
  const directory = resolve('node_modules/@ffmpeg/core/dist/esm');
  return {
    name: 'local-ffmpeg-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = files.find(file => request.url?.endsWith(`/ffmpeg/${file}`));
        if (!name) return next();
        response.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        response.end(readFileSync(resolve(directory, name)));
      });
    },
    generateBundle() {
      for (const file of files) this.emitFile({ type: 'asset', fileName: `ffmpeg/${file}`, source: readFileSync(resolve(directory, file)) });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), ffmpegAssets()],
  server: { port: 3000, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1100 },
});
