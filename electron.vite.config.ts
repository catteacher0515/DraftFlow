import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: 'src/main.ts'
      }
    }
  },
  preload: {
    build: {
      lib: {
        entry: 'src/preload.ts',
        formats: ['cjs']
      }
    }
  },
  renderer: {}
});
