import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './database.js';

const config = loadConfig();
const db = createDatabase(config);
const app = createApp(db, config.JWT_SECRET);
const server = app.listen(config.PORT, '0.0.0.0', () => {
  console.log(`OrderFlow API listening on port ${config.PORT}`);
});

// Stops new requests and closes the pool when the process is asked to exit.
async function shutdown() {
  server.close(async () => {
    await db.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
