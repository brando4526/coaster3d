import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so dist/ works from any subfolder (e.g. http://localhost/coaster3d/dist/).
  base: './',
  // Three.js alone is ~600 kB minified; one chunk is fine for this single-scene app.
  build: { chunkSizeWarningLimit: 900 },
});
