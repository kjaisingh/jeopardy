import { createAppServer } from './appServer.js';
import { gameStore } from './gameStore.js';

const server = createAppServer();
const address = await server.start();

console.log(`Jeopardy server listening on port ${address.port}`);
const persistenceWarning = gameStore.persistenceConfigError();
if (persistenceWarning) console.warn(persistenceWarning);

let stopping = false;
const stop = async (signal) => {
  if (stopping) return;
  stopping = true;
  console.log(`Received ${signal}; flushing room state before shutdown`);
  try {
    await server.stop();
    process.exitCode = 0;
  } catch (error) {
    console.error('Graceful shutdown failed:', error);
    process.exitCode = 1;
  }
};

process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
