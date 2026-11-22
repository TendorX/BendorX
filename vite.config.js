import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/BendorX/',
  build: {
    outDir: 'web',
    emptyOutDir: true,
    sourcemap: false
  }
});
