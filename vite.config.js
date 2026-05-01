import { defineConfig, loadEnv } from 'vite';
import { devApiPlugin } from './src/dev-api.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [devApiPlugin(env)],
    server: { port: 5173 },
  };
});
