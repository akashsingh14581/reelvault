import mongoose from 'mongoose';
import { config, validateConfig } from './config.js';
import { log } from './logger.js';
import { createApp } from './app.js';
import { initStorage } from './services/storage.js';
import { startWorkers, stopWorkers } from './services/workers.js';

const problems = validateConfig();
if (problems.length) {
  console.error('ReelVault cannot start. Fix your environment variables:\n - ' + problems.join('\n - '));
  process.exit(1);
}

initStorage();
mongoose.set('strictQuery', true);
await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000 });
log.info('db.connected');

const app = createApp();
const server = app.listen(config.port, () => log.info('server.listening', { port: config.port }));
startWorkers();

async function shutdown(signal) {
  log.info('server.shutdown', { signal });
  stopWorkers();
  server.close(() => mongoose.connection.close().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => log.error('unhandled_rejection', { error: err }));
