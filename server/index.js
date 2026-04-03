import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { gameStore } from './gameStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const persistenceWarning = gameStore.persistenceConfigError();

app.use(
  cors({
    origin: process.env.CLIENT_URL || true
  })
);
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    persistenceEnabled: gameStore.persistenceEnabled()
  });
});

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || true,
    credentials: true
  }
});

const sendRoom = (code, room) => {
  io.to(code).emit('room:updated', room);
};

const emitError = (socket, error) => {
  socket.emit('room:error', { message: error.message || 'Unexpected error' });
};

io.on('connection', (socket) => {
  socket.on('room:create', async ({ name }, ack) => {
    try {
      const result = await gameStore.createRoom(name, socket.id);
      socket.join(result.code);
      ack({ ok: true, code: result.code, playerId: result.playerId, room: result.room });
      sendRoom(result.code, result.room);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('room:join', async ({ code, name }, ack) => {
    try {
      const result = await gameStore.joinRoom(code, name, socket.id);
      socket.join(result.code);
      ack({ ok: true, code: result.code, playerId: result.playerId, room: result.room });
      sendRoom(result.code, result.room);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('room:reconnect', async ({ code, playerId }, ack) => {
    try {
      const result = await gameStore.reconnect(code, playerId, socket.id);
      socket.join(result.code);
      ack({ ok: true, room: result.room });
      sendRoom(result.code, result.room);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('questions:submit', async ({ code, playerId, questions }, ack) => {
    try {
      const room = await gameStore.submitQuestions(code, playerId, questions);
      ack({ ok: true });
      sendRoom(code.toUpperCase(), room);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('game:configure', async ({ code, playerId, config }, ack) => {
    try {
      const room = await gameStore.setTeamsAndSettings(code, playerId, config);
      ack({ ok: true });
      sendRoom(code.toUpperCase(), room);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('team:score:set', async ({ code, playerId, teamId, score }, ack) => {
    try {
      const room = await gameStore.setTeamScore(code, playerId, teamId, score);
      ack({ ok: true });
      sendRoom(code.toUpperCase(), room);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('question:select', async ({ code, playerId, ownerPlayerId, value }, ack) => {
    try {
      const room = await gameStore.selectQuestion(code, playerId, ownerPlayerId, value);
      ack({ ok: true });
      sendRoom(code.toUpperCase(), room);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('question:attempt', async ({ code, playerId, answer }, ack) => {
    try {
      const { room, result } = await gameStore.submitAttempt(code, playerId, answer);
      ack({ ok: true, result });
      sendRoom(code.toUpperCase(), room);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('question:override', async ({ code, playerId }, ack) => {
    try {
      const room = await gameStore.overrideLastIncorrect(code, playerId);
      ack({ ok: true });
      sendRoom(code.toUpperCase(), room);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('question:pass', async ({ code, playerId }, ack) => {
    try {
      const room = await gameStore.passActiveQuestion(code, playerId);
      ack({ ok: true });
      sendRoom(code.toUpperCase(), room);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('game:restart', async ({ code, playerId }, ack) => {
    try {
      const restarted = await gameStore.restartGame(code, playerId);
      const sockets = await io.in(code.toUpperCase()).fetchSockets();
      await Promise.all(sockets.map((entry) => entry.leave(code.toUpperCase())));
      await Promise.all(sockets.map((entry) => entry.join(restarted.newCode)));

      ack({ ok: true, newCode: restarted.newCode });
      sendRoom(restarted.newCode, restarted.room);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('room:state', (_payload, ack) => {
    try {
      const context = gameStore.getPlayerContext(socket.id);
      ack({ ok: true, context });
    } catch (error) {
      emitError(socket, error);
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('disconnect', () => {
    const result = gameStore.disconnect(socket.id);
    if (result) sendRoom(result.code, result.room);
  });
});

const distDir = path.resolve(__dirname, '../dist');
app.use(express.static(distDir));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

const port = Number(process.env.PORT || 3001);
httpServer.listen(port, () => {
  console.log(`Jeopardy server listening on port ${port}`);
  if (persistenceWarning) {
    console.warn(persistenceWarning);
  }
});