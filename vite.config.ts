import { defineConfig, Plugin } from 'vite';
// @ts-ignore - plain ESM module shared with the production server
import { createGameServer } from './server/game-server.mjs';

/** Runs multiplayer rooms and the leaderboard inside the Vite dev server. */
function gameServer(): Plugin {
  return {
    name: 'dta-game-server',
    configureServer(server) {
      const game = createGameServer({ dataDir: process.cwd() });
      server.httpServer?.on('upgrade', (req, socket, head) => { game.handleUpgrade(req, socket, head); });
      server.middlewares.use(async (req, res, next) => { if (!(await game.handleApi(req, res))) next(); });
    },
  };
}

export default defineConfig({
  // GitHub Pages serves project sites from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH || '/',
  plugins: [gameServer()],
  server: { port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
