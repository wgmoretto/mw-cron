import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { config } from './config.js';
import { initDatabase, saveDatabase } from './database.js';
import { createRoutes } from './routes.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('╔══════════════════════════════╗');
  console.log('║       MW-Cron Monitor        ║');
  console.log('╚══════════════════════════════╝');

  await initDatabase();
  console.log('[DB] SQLite initialized');

  const app = new Hono();

  app.use('/static/*', serveStatic({ root: path.relative(process.cwd(), __dirname) }));

  const routes = createRoutes();
  app.route('/', routes);

  startScheduler();

  const server = serve({
    fetch: app.fetch,
    port: parseInt(config.port),
  }, (info) => {
    console.log(`[Server] Running at http://localhost:${info.port}`);
    console.log(`[Auth] User: ${config.adminUser}`);
  });

  // Graceful shutdown
  function shutdown(signal) {
    console.log(`\n[${signal}] Shutting down...`);
    stopScheduler();
    saveDatabase();
    console.log('[DB] Saved');
    server.close(() => {
      console.log('[Server] Closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
