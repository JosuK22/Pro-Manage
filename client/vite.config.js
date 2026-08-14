import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Split the heavier third-party libraries out of the app chunk so a code
    // change doesn't invalidate the vendor bundle in users' caches.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          forms: ['react-hook-form', 'yup', '@hookform/resolvers', 'react-select'],
          datepicker: ['react-datepicker'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './tests/setup.js',
    include: ['tests/**/*.test.{js,jsx}'],
    css: false,
  },
});
