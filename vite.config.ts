import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [
    react({
      jsxImportSource: '@emotion/react',
      babel: {
        plugins: ['@emotion/babel-plugin'],
      },
    }),
  ],
  resolve: {
    alias: {
      // Resolve `canva-editor/*` imports used throughout the source
      // to the local src/ directory so they work when running standalone
      'canva-editor': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/fonts': 'http://localhost:3000',
      '/search-fonts': 'http://localhost:3000',
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'hoist-non-react-statics',
      '@emotion/react',
      '@emotion/styled',
      '@emotion/css',
    ],
  },
});
