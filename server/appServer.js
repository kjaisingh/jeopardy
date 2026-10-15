import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Server } from 'socket.io';
import { gameStore } from './gameStore.js';
import { requiredObject } from './validate.js';
import { positiveIntegerFromEnv } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RATE_WINDOW_MS = 10_000;
const RATE_LIMIT = 120;

export function createAppServer({
  store = gameStore
} = {}) {
  const app = express();
  const httpServer = createServer(app);
  const localPort = positiveIntegerFromEnv('PORT', 3001);
  const allowedOrigins = [
    process.env.CLIENT_URL,
    'http://localhost:5173',
    `http://localhost:${localPort}`,
    `http://127.0.0.1:${localPort}`
  ].filter(Boolean);
  const timers = new Map();
  const hostPromotionTimers = new Map();

  const corsOrigin = (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error(`Origin not allowed by CORS: ${origin}`));
  };

  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: null
        }
      },
      crossOriginEmbedderPolicy: false,
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' }
    })
  );
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: '32kb' }));
  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      persistenceEnabled: store.persistenceEnabled(),
      persistence: store.persistenceStatus()
    });
  });
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
    maxHttpBufferSize: 64 * 1024,
    perMessageDeflate: false
  });

  const sendRoom = (code) => {
    for (const { socketId, room } of store.roomViews(code)) {
      io.to(socketId).emit('room:updated', room);
    }
  };

  const syncQuestionTimer = (code) => {
    clearTimeout(timers.get(code));
    timers.delete(code);
    const active = store.activeTimer(code);
    if (!active) return;

    const timeout = setTimeout(async () => {
      timers.delete(code);
      try {
        const result = await store.expireAttempt(code, active.questionId, active.attemptIndex);
        if (result) sendRoom(code);
      } catch (error) {
        console.error('Question timer failed:', error);
      } finally {
        syncQuestionTimer(code);
      }
    }, Math.max(0, active.deadlineAt - Date.now()));
    timeout.unref?.();
    timers.set(code, timeout);
  };

  const scheduleHostPromotion = (code) => {
    clearTimeout(hostPromotionTimers.get(code));
    hostPromotionTimers.delete(code);
    const delay = store.hostPromotionDelay(code);
    if (delay === null) return;
    const timeout = setTimeout(async () => {
      hostPromotionTimers.delete(code);
      try {
        if (await store.maybePromoteHost(code)) sendRoom(code);
        else if (store.hostPromotionDelay(code) > 0) scheduleHostPromotion(code);
      } catch (error) {
        console.error('Host promotion failed:', error);
      }
    }, delay);
    timeout.unref?.();
    hostPromotionTimers.set(code, timeout);
  };

  const bindSession = (socket, result) => {
    const previousSocketId = result.supersededSocketId;
    if (previousSocketId && previousSocketId !== socket.id) {
      const previousSocket = io.sockets.sockets.get(previousSocketId);
      if (previousSocket) previousSocket.data.session = null;
      previousSocket?.emit('session:superseded');
    }
    socket.data.session = { code: result.code, playerId: result.playerId };
  };

  const establishSession = async (socket, createSession) => {
    if (socket.data.session || socket.data.sessionPending) {
      throw new Error('Leave your current room before joining another');
    }

    socket.data.sessionPending = true;
    try {
      const result = await createSession();
      bindSession(socket, result);
      return result;
    } finally {
      socket.data.sessionPending = false;
    }
  };

  const actorFor = (socket) => {
    if (!socket.data.session) throw new Error('Reconnect to the room before trying that action');
    return socket.data.session;
  };

  const withinRateLimit = (socket) => {
    const now = Date.now();
    const recent = (socket.data.eventTimes || []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
    recent.push(now);
    socket.data.eventTimes = recent;
    return recent.length <= RATE_LIMIT;
  };

  const onRequest = (socket, event, handler) => {
    socket.on(event, async (rawPayload, rawAck) => {
      const ack = typeof rawAck === 'function' ? rawAck : () => {};
      try {
        if (!withinRateLimit(socket)) throw new Error('Too many requests. Wait a moment and try again.');
        const payload = rawPayload === undefined ? {} : requiredObject(rawPayload);
        const response = await handler(payload);
        ack({ ok: true, ...response });
      } catch (error) {
        const isProgrammingError =
          error instanceof TypeError ||
          error instanceof ReferenceError ||
          error instanceof SyntaxError;
        if (isProgrammingError) console.error(`Unexpected ${event} failure:`, error);
        const message =
          error instanceof Error && !isProgrammingError
            ? error.message
            : 'Operation failed. Try again.';
        ack({ ok: false, message });
      }
    });
  };

  io.on('connection', (socket) => {
    onRequest(socket, 'room:create', async ({ name, settings }) => {
      const result = await establishSession(socket, () => store.createRoom(name, socket.id, settings));
      sendRoom(result.code);
      return {
        code: result.code,
        playerId: result.playerId,
        sessionToken: result.sessionToken,
        room: result.room
      };
    });

    onRequest(socket, 'room:join', async ({ code, name }) => {
      const result = await establishSession(socket, () => store.joinRoom(code, name, socket.id));
      sendRoom(result.code);
      scheduleHostPromotion(result.code);
      return {
        code: result.code,
        playerId: result.playerId,
        sessionToken: result.sessionToken,
        room: result.room
      };
    });

    onRequest(socket, 'room:reconnect', async ({ code, sessionToken }) => {
      const result = await establishSession(socket, () => store.reconnect(code, sessionToken, socket.id));
      sendRoom(result.code);
      syncQuestionTimer(result.code);
      scheduleHostPromotion(result.code);
      return { playerId: result.playerId, room: result.room };
    });

    onRequest(socket, 'questions:submit', async ({ questions }) => {
      const actor = actorFor(socket);
      await store.submitQuestions(actor.code, actor.playerId, questions);
      sendRoom(actor.code);
      return {};
    });

    onRequest(socket, 'lobby:continue', async () => {
      const actor = actorFor(socket);
      await store.advanceToTeamSetup(actor.code, actor.playerId);
      sendRoom(actor.code);
      return {};
    });

    onRequest(socket, 'game:configure', async ({ config }) => {
      const actor = actorFor(socket);
      await store.setTeams(actor.code, actor.playerId, requiredObject(config, 'Team configuration'));
      sendRoom(actor.code);
      return {};
    });

    onRequest(socket, 'game:settings', async ({ settings }) => {
      const actor = actorFor(socket);
      await store.updateSettings(actor.code, actor.playerId, requiredObject(settings, 'Settings'));
      sendRoom(actor.code);
      return {};
    });

    onRequest(socket, 'team:score:set', async ({ teamId, score }) => {
      const actor = actorFor(socket);
      await store.setTeamScore(actor.code, actor.playerId, teamId, score);
      sendRoom(actor.code);
      return {};
    });

    onRequest(socket, 'question:select', async ({ ownerPlayerId, value }) => {
      const actor = actorFor(socket);
      await store.selectQuestion(actor.code, actor.playerId, ownerPlayerId, value);
      sendRoom(actor.code);
      syncQuestionTimer(actor.code);
      return {};
    });

    onRequest(socket, 'question:attempt', async ({ answer }) => {
      const actor = actorFor(socket);
      const { result } = await store.submitAttempt(actor.code, actor.playerId, answer);
      sendRoom(actor.code);
      syncQuestionTimer(actor.code);
      return { result };
    });

    onRequest(socket, 'question:skip', async () => {
      const actor = actorFor(socket);
      const { result } = await store.skipCurrentTeam(actor.code, actor.playerId);
      sendRoom(actor.code);
      syncQuestionTimer(actor.code);
      return { result };
    });

    onRequest(socket, 'question:override', async () => {
      const actor = actorFor(socket);
      const { result } = await store.overrideLastIncorrect(actor.code, actor.playerId);
      sendRoom(actor.code);
      syncQuestionTimer(actor.code);
      return { result };
    });

    onRequest(socket, 'question:pass', async () => {
      const actor = actorFor(socket);
      const { result } = await store.passActiveQuestion(actor.code, actor.playerId);
      sendRoom(actor.code);
      syncQuestionTimer(actor.code);
      return { result };
    });

    onRequest(socket, 'game:restart', async () => {
      const actor = actorFor(socket);
      const restarted = await store.restartGame(actor.code, actor.playerId);
      clearTimeout(timers.get(actor.code));
      timers.delete(actor.code);
      clearTimeout(hostPromotionTimers.get(actor.code));
      hostPromotionTimers.delete(actor.code);

      for (const playerSocket of io.sockets.sockets.values()) {
        if (playerSocket.data.session?.code === actor.code) {
          playerSocket.data.session = {
            ...playerSocket.data.session,
            code: restarted.newCode
          };
        }
      }

      sendRoom(restarted.newCode);
      return { newCode: restarted.newCode };
    });

    onRequest(socket, 'player:kick', async ({ targetPlayerId }) => {
      const actor = actorFor(socket);
      const { kickedSocketId } = await store.kickPlayer(actor.code, actor.playerId, targetPlayerId);
      if (kickedSocketId) {
        const kickedSocket = io.sockets.sockets.get(kickedSocketId);
        if (kickedSocket) kickedSocket.data.session = null;
        kickedSocket?.emit('room:kicked');
      }
      sendRoom(actor.code);
      return {};
    });

    onRequest(socket, 'room:leave', async () => {
      const actor = actorFor(socket);
      const result = await store.leaveRoom(actor.code, actor.playerId);
      socket.data.session = null;
      if (result) {
        sendRoom(result.code);
        if (result.wasHost) scheduleHostPromotion(result.code);
      }
      return {};
    });

    onRequest(socket, 'room:forget', async ({ code, sessionToken }) => {
      const detachedLeave = code !== undefined || sessionToken !== undefined;
      let result;
      if (detachedLeave) {
        result = await store.removeDetachedPlayer(code, sessionToken);
      } else {
        const actor = actorFor(socket);
        result = await store.removePlayer(actor.code, actor.playerId);
        socket.data.session = null;
      }
      if (result) {
        if (result.wasHost) {
          clearTimeout(hostPromotionTimers.get(result.code));
          hostPromotionTimers.delete(result.code);
        }
        sendRoom(result.code);
      }
      return {};
    });

    socket.on('disconnect', () => {
      const result = store.disconnect(socket.id);
      socket.data.session = null;
      if (!result) return;
      sendRoom(result.code);
      if (result.wasHost) scheduleHostPromotion(result.code);
    });
  });

  const distDir = path.resolve(__dirname, '../dist');
  app.use(express.static(distDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });

  const pruneInterval = setInterval(() => {
    store.pruneInactiveRooms().catch((error) => console.error('Room cleanup failed:', error));
  }, 60 * 60 * 1000);
  pruneInterval.unref?.();

  return {
    app,
    io,
    httpServer,
    async start(port = positiveIntegerFromEnv('PORT', 3001)) {
      await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, resolve);
      });
      return httpServer.address();
    },
    async stop() {
      clearInterval(pruneInterval);
      for (const timeout of timers.values()) clearTimeout(timeout);
      for (const timeout of hostPromotionTimers.values()) clearTimeout(timeout);
      await new Promise((resolve) => io.close(resolve));
      for (const timeout of hostPromotionTimers.values()) clearTimeout(timeout);
      hostPromotionTimers.clear();
      await store.flushPersistence();
      if (httpServer.listening) {
        await new Promise((resolve) => httpServer.close(resolve));
      }
    }
  };
}
