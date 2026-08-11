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

const allowedOrigins = [process.env.CLIENT_URL, 'http://localhost:5173'].filter(Boolean);
const corsOrigin = (origin, callback) => {
  if (!origin || allowedOrigins.includes(origin)) callback(null, true);
  else callback(new Error('Not allowed by CORS'));
};

app.use(cors({ origin: corsOrigin }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    persistenceEnabled: gameStore.persistenceEnabled()
  });
});

const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    credentials: true
  }
});

const sendRoom = (code) => {
  for (const { socketId, room } of gameStore.roomViews(code)) {
    io.to(socketId).emit('room:updated', room);
  }
};

io.on('connection', (socket) => {
  socket.on('room:create', async ({ name, settings } = {}, ack = () => {}) => {
    try {
      const result = await gameStore.createRoom(name, socket.id, settings);
      ack({ ok: true, code: result.code, playerId: result.playerId, room: result.room });
      sendRoom(result.code);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('room:join', async ({ code, name } = {}, ack = () => {}) => {
    try {
      const result = await gameStore.joinRoom(code, name, socket.id);
      ack({ ok: true, code: result.code, playerId: result.playerId, room: result.room });
      sendRoom(result.code);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('room:reconnect', async ({ code, playerId } = {}, ack = () => {}) => {
    try {
      const result = await gameStore.reconnect(code, playerId, socket.id);
      ack({ ok: true, room: result.room });
      if (result.supersededSocketId) {
        io.sockets.sockets.get(result.supersededSocketId)?.emit('session:superseded');
      }
      sendRoom(result.code);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('questions:submit', async ({ code, playerId, questions } = {}, ack = () => {}) => {
    try {
      const room = await gameStore.submitQuestions(code, playerId, questions);
      ack({ ok: true });
      sendRoom(room.code);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('lobby:continue', async ({ code, playerId } = {}, ack = () => {}) => {
    try {
      const room = await gameStore.advanceToTeamSetup(code, playerId);
      ack({ ok: true });
      sendRoom(room.code);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('game:configure', async ({ code, playerId, config } = {}, ack = () => {}) => {
    try {
      const room = await gameStore.setTeams(code, playerId, config);
      ack({ ok: true });
      sendRoom(room.code);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('game:settings', async ({ code, playerId, settings } = {}, ack = () => {}) => {
    try {
      const room = await gameStore.updateSettings(code, playerId, settings);
      ack({ ok: true });
      sendRoom(room.code);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('team:score:set', async ({ code, playerId, teamId, score } = {}, ack = () => {}) => {
    try {
      const room = await gameStore.setTeamScore(code, playerId, teamId, score);
      ack({ ok: true });
      sendRoom(room.code);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('question:select', async ({ code, playerId, ownerPlayerId, value } = {}, ack = () => {}) => {
    try {
      const room = await gameStore.selectQuestion(code, playerId, ownerPlayerId, value);
      ack({ ok: true });
      sendRoom(room.code);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('question:attempt', async ({ code, playerId, answer } = {}, ack = () => {}) => {
    try {
      const { room, result } = await gameStore.submitAttempt(code, playerId, answer);
      ack({ ok: true, result });
      sendRoom(room.code);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('question:skip', async ({ code, playerId } = {}, ack = () => {}) => {
    try {
      const { room, result } = await gameStore.skipCurrentTeam(code, playerId);
      ack({ ok: true, result });
      sendRoom(room.code);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('question:override', async ({ code, playerId } = {}, ack = () => {}) => {
    try {
      const { room, result } = await gameStore.overrideLastIncorrect(code, playerId);
      ack({ ok: true, result });
      sendRoom(room.code);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('question:pass', async ({ code, playerId } = {}, ack = () => {}) => {
    try {
      const { room, result } = await gameStore.passActiveQuestion(code, playerId);
      ack({ ok: true, result });
      sendRoom(room.code);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('game:restart', async ({ code, playerId } = {}, ack = () => {}) => {
    try {
      const restarted = await gameStore.restartGame(code, playerId);
      ack({ ok: true, newCode: restarted.newCode });
      sendRoom(restarted.newCode);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('player:kick', async ({ code, playerId, targetPlayerId } = {}, ack = () => {}) => {
    try {
      const { room, kickedSocketId } = await gameStore.kickPlayer(code, playerId, targetPlayerId);
      ack({ ok: true });
      if (kickedSocketId) {
        io.to(kickedSocketId).emit('room:kicked');
      }
      sendRoom(room.code);
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('room:leave', async ({ code, playerId } = {}, ack = () => {}) => {
    try {
      const result = await gameStore.leaveRoom(code, playerId);
      ack({ ok: true });
      if (!result) return;
      sendRoom(result.code);
      if (result.wasHost) {
        setTimeout(async () => {
          if (await gameStore.maybePromoteHost(result.code)) sendRoom(result.code);
        }, gameStore.HOST_GRACE_MS);
      }
    } catch (error) {
      ack({ ok: false, message: error.message });
    }
  });

  socket.on('disconnect', () => {
    const result = gameStore.disconnect(socket.id);
    if (!result) return;
    sendRoom(result.code);
    if (result.wasHost) {
      setTimeout(async () => {
        if (await gameStore.maybePromoteHost(result.code)) sendRoom(result.code);
      }, gameStore.HOST_GRACE_MS);
    }
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