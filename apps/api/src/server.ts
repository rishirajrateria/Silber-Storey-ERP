import { buildApp } from './app.js';
import { config } from './config.js';
import { initRealtime } from './realtime.js';
import { startSchedulers } from './jobs/queue.js';

const app = await buildApp();
await app.ready();
initRealtime(app.server);
startSchedulers();
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`API on ${config.apiUrl}  (MOCK_MODE=${config.mockMode}, queue=${config.queueMode})`);
