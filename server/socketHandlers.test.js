import test from 'node:test';
import assert from 'node:assert/strict';
import { io as createClient } from 'socket.io-client';
import { createAppServer } from './appServer.js';
import { gameStore } from './gameStore.js';

const SETTINGS = {
  mode: 'finite',
  rounds: 1,
  dailyDouble: false,
  timerSeconds: 0,
  questionsPerPlayer: 1
};

test('WebSocket handshakes reject untrusted browser origins', async () => {
  const server = createAppServer();
  const address = await server.start(0);
  const socket = createClient(`http://127.0.0.1:${address.port}`, {
    transports: ['websocket'], reconnection: false,
    extraHeaders: { Origin: 'https://untrusted.example' }
  });
  try {
    await new Promise((resolve, reject) => {
      socket.once('connect_error', resolve);
      socket.once('connect', () => reject(new Error('Untrusted origin connected')));
    });
  } finally {
    socket.disconnect();
    await server.stop();
  }
});

test('repeated session requests recover their original credentials', async () => {
  const server = createAppServer();
  const address = await server.start(0);
  const socket = await connect(`http://127.0.0.1:${address.port}`);
  try {
    const payload = { name: 'Host', settings: SETTINGS };
    const first = await request(socket, 'room:create', payload);
    const retry = await request(socket, 'room:create', payload);
    assert.equal(retry.ok, true);
    assert.equal(retry.code, first.code);
    assert.equal(retry.sessionToken, first.sessionToken);
    assert.equal(retry.room.players.length, 1);
    await request(socket, 'room:leave');
    const resume = { code: first.code, sessionToken: first.sessionToken };
    assert.equal((await request(socket, 'room:reconnect', resume)).ok, true);
    assert.equal((await request(socket, 'room:reconnect', resume)).ok, true);
  } finally {
    socket.disconnect();
    await server.stop();
  }
});

for (const event of ['room:create', 'room:join', 'room:reconnect']) {
  test(`${event} finishing after disconnect cannot leave a ghost connection`, async () => {
    let release;
    let liveSocketId = null;
    let cleaned = false;
    const establish = async (...args) => {
      const socketId = args[event === 'room:create' ? 1 : 2];
      await new Promise((resolve) => { release = resolve; });
      liveSocketId = socketId;
      return { code: 'ABC234', playerId: 'player', room: {} };
    };
    const store = {
      createRoom: establish, joinRoom: establish, reconnect: establish,
      roomViews: () => [], hostPromotionDelay: () => null,
      disconnect: (socketId) => {
        if (liveSocketId !== socketId) return null;
        liveSocketId = null;
        cleaned = true;
        return { code: 'ABC234', wasHost: true };
      },
      pruneInactiveRooms: async () => {}, flushPersistence: async () => {}
    };
    const server = createAppServer({ store });
    const address = await server.start(0);
    const socket = await connect(`http://127.0.0.1:${address.port}`);
    try {
      socket.emit(event, { code: 'ABC234', name: 'Host', settings: SETTINGS, sessionToken: 'token' });
      while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
      const disconnected = new Promise((resolve) => server.io.sockets.sockets.get(socket.id).once('disconnect', resolve));
      socket.disconnect();
      await disconnected;
      release();
      const deadline = Date.now() + 1000;
      while (!cleaned && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(cleaned, true);
      assert.equal(liveSocketId, null);
    } finally {
      socket.disconnect();
      await server.stop();
    }
  });
}

const request = (socket, event, payload = {}) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${event} timed out`)), 2000);
    socket.emit(event, payload, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });
  });

const connect = (url) =>
  new Promise((resolve, reject) => {
    const socket = createClient(url, { transports: ['websocket'], forceNew: true });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });

test('health reports persistence state with security headers', async () => {
  const store = {
    persistenceEnabled: () => true,
    persistenceStatus: () => ({ pendingWrites: 0, lastSuccessAt: null, lastErrorAt: null }),
    pruneInactiveRooms: async () => {},
    flushPersistence: async () => {}
  };
  const server = createAppServer({ store });
  const address = await server.start(0);
  const url = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${url}/health`, {
      headers: { Origin: 'http://localhost:3001' }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      commit: process.env.RENDER_GIT_COMMIT || null,
      persistenceEnabled: true,
      persistence: { pendingWrites: 0, lastSuccessAt: null, lastErrorAt: null }
    });
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:3001');
    assert.equal((await fetch(`${url}/health/persistence`)).status, 404);
  } finally {
    await server.stop();
  }
});

test('socket handlers distinguish resume from permanent lobby departure', async () => {
  const server = createAppServer();
  const address = await server.start(0);
  const url = `http://127.0.0.1:${address.port}`;
  const sockets = [];
  try {
    const host = await connect(url);
    const guest = await connect(url);
    sockets.push(host, guest);
    const created = await request(host, 'room:create', { name: 'Host', settings: SETTINGS });
    const joined = await request(guest, 'room:join', { code: created.code, name: 'Guest' });

    assert.equal((await request(guest, 'room:leave')).ok, true);
    assert.equal((await request(guest, 'room:reconnect', {
      code: created.code, sessionToken: joined.sessionToken
    })).ok, true);
    assert.equal((await request(guest, 'room:leave')).ok, true);
    assert.equal((await request(guest, 'room:forget', {
      code: created.code, sessionToken: joined.sessionToken
    })).ok, true);

    const staleSession = await request(guest, 'room:forget', {
      code: created.code, sessionToken: joined.sessionToken
    });
    assert.equal(staleSession.ok, false);
    assert.equal((await request(guest, 'room:reconnect', {
      code: created.code, sessionToken: joined.sessionToken
    })).ok, false);
    const replacement = await request(guest, 'room:join', { code: created.code, name: 'Guest' });
    assert.equal(replacement.ok, true);
  } finally {
    sockets.forEach((socket) => socket.disconnect());
    await server.stop();
  }
});

test('forgetting a detached room cannot clear a newly joined socket session', async () => {
  const server = createAppServer();
  const address = await server.start(0);
  const url = `http://127.0.0.1:${address.port}`;
  const sockets = [];
  try {
    const oldHost = await connect(url);
    const guest = await connect(url);
    sockets.push(oldHost, guest);
    const oldRoom = await request(oldHost, 'room:create', { name: 'Old Host', settings: SETTINGS });
    const joined = await request(guest, 'room:join', { code: oldRoom.code, name: 'Guest' });
    assert.equal((await request(guest, 'room:leave')).ok, true);

    const newRoom = await request(guest, 'room:create', { name: 'New Host', settings: SETTINGS });
    assert.equal(newRoom.ok, true);
    assert.equal((await request(guest, 'room:forget', {
      code: oldRoom.code, sessionToken: joined.sessionToken
    })).ok, true);
    assert.equal((await request(guest, 'questions:submit', {
      questions: [{ prompt: 'A clue', answer: 'An answer', value: 100 }]
    })).ok, true);
  } finally {
    sockets.forEach((socket) => socket.disconnect());
    await server.stop();
  }
});

test('a new player inherits hosting after the old host disconnected', async () => {
  const server = createAppServer();
  const address = await server.start(0);
  const url = `http://127.0.0.1:${address.port}`;
  const sockets = [];
  try {
    const host = await connect(url);
    sockets.push(host);
    const created = await request(host, 'room:create', { name: 'Host', settings: SETTINGS });
    host.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 2 * gameStore.HOST_GRACE_MS));

    const guest = await connect(url);
    sockets.push(guest);
    const joined = await request(guest, 'room:join', { code: created.code, name: 'Guest' });
    assert.equal(joined.ok, true);
    assert.equal(joined.room.hostPlayerId, joined.playerId);
  } finally {
    sockets.forEach((socket) => socket.disconnect());
    await server.stop();
  }
});

test('a player joining during host grace is promoted when grace expires', async () => {
  const server = createAppServer();
  const address = await server.start(0);
  const url = `http://127.0.0.1:${address.port}`;
  const sockets = [];
  try {
    const host = await connect(url);
    sockets.push(host);
    const created = await request(host, 'room:create', { name: 'Host', settings: SETTINGS });
    host.disconnect();

    const guest = await connect(url);
    sockets.push(guest);
    const promoted = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(
        `Host promotion timed out (delay=${gameStore.hostPromotionDelay(created.code)}, recipients=${gameStore.roomViews(created.code).length})`
      )), 5000);
      guest.on('room:updated', (room) => {
        if (room.hostPlayerId && room.hostPlayerId !== created.playerId) {
          clearTimeout(timeout);
          resolve(room);
        }
      });
    });
    const joined = await request(guest, 'room:join', { code: created.code, name: 'Guest' });
    assert.equal(joined.ok, true);
    assert.equal((await promoted).hostPlayerId, joined.playerId);
  } finally {
    sockets.forEach((socket) => socket.disconnect());
    await server.stop();
  }
});

test('socket handlers bind actions to authenticated sessions and reject forged identities', async () => {
  const server = createAppServer();
  const address = await server.start(0);
  const url = `http://127.0.0.1:${address.port}`;
  const sockets = [];

  try {
    const host = await connect(url);
    const guest = await connect(url);
    const replacement = await connect(url);
    sockets.push(host, guest, replacement);

    const created = await request(host, 'room:create', { name: 'Host', settings: SETTINGS });
    assert.equal(created.ok, true);
    assert.match(created.sessionToken, /^[A-Za-z0-9_-]{40,}$/);

    const joined = await request(guest, 'room:join', { code: created.code, name: 'Guest' });
    assert.equal(joined.ok, true);

    const forgedHostAction = await request(guest, 'lobby:continue', {
      code: created.code,
      playerId: created.playerId
    });
    assert.equal(forgedHostAction.ok, false);
    assert.match(forgedHostAction.message, /Only host/);

    const guessedReconnect = await request(replacement, 'room:reconnect', {
      code: created.code,
      sessionToken: joined.playerId
    });
    assert.equal(guessedReconnect.ok, false);
    assert.match(guessedReconnect.message, /invalid or expired/);

    const reconnected = await request(replacement, 'room:reconnect', {
      code: created.code,
      sessionToken: joined.sessionToken
    });
    assert.equal(reconnected.ok, true);
    assert.equal(reconnected.playerId, joined.playerId);

    const supersededMutation = await request(guest, 'questions:submit', {
      code: created.code,
      playerId: joined.playerId,
      questions: [{ prompt: 'Question', answer: 'Answer', value: 100 }]
    });
    assert.equal(supersededMutation.ok, false);
    assert.match(supersededMutation.message, /Reconnect/);
  } finally {
    sockets.forEach((socket) => socket.disconnect());
    await server.stop();
  }
});

test('socket handlers tolerate missing acknowledgements and malformed payloads', async () => {
  const server = createAppServer();
  const address = await server.start(0);
  const url = `http://127.0.0.1:${address.port}`;
  const socket = await connect(url);

  try {
    socket.emit('room:create', null);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const valid = await request(socket, 'room:create', { name: 'Still Alive', settings: SETTINGS });
    assert.equal(valid.ok, true);

    const secondRoom = await request(socket, 'room:create', { name: 'Ghost', settings: SETTINGS });
    assert.equal(secondRoom.ok, false);
    assert.match(secondRoom.message, /Leave your current room/);
  } finally {
    socket.disconnect();
    await server.stop();
  }
});

test('restart rebinds every connected player to the new room code', async () => {
  const server = createAppServer();
  const address = await server.start(0);
  const url = `http://127.0.0.1:${address.port}`;
  const host = await connect(url);
  const guest = await connect(url);

  try {
    const created = await request(host, 'room:create', { name: 'Host', settings: SETTINGS });
    const joined = await request(guest, 'room:join', { code: created.code, name: 'Guest' });
    const question = (label) => [{ prompt: `${label} prompt`, answer: `${label} answer`, value: 100 }];

    assert.equal((await request(host, 'questions:submit', { questions: question('Host') })).ok, true);
    assert.equal((await request(guest, 'questions:submit', { questions: question('Guest') })).ok, true);
    assert.equal((await request(host, 'lobby:continue')).ok, true);
    assert.equal(
      (
        await request(host, 'game:configure', {
          config: {
            teams: [
              { name: 'Hosts', playerIds: [created.playerId] },
              { name: 'Guests', playerIds: [joined.playerId] }
            ]
          }
        })
      ).ok,
      true
    );

    for (const playerId of [created.playerId, joined.playerId]) {
      assert.equal((await request(host, 'question:select', { ownerPlayerId: playerId, value: 100 })).ok, true);
      const active = gameStore.roomViews(created.code).find((view) => view.socketId === host.id).room.activeQuestion;
      assert.equal((await request(host, 'question:pass', {
        questionId: active.id, attemptIndex: active.attemptIndex
      })).ok, true);
    }

    const restarted = await request(host, 'game:restart');
    assert.equal(restarted.ok, true);
    assert.notEqual(restarted.newCode, created.code);

    const guestSubmission = await request(guest, 'questions:submit', {
      questions: question('Restarted guest')
    });
    assert.equal(guestSubmission.ok, true);
  } finally {
    host.disconnect();
    guest.disconnect();
    await server.stop();
  }
});

test('reconnect schedules a later host-promotion check', async () => {
  let promotionChecks = 0;
  let promotionDelay = 10;
  const store = {
    HOST_GRACE_MS: 10,
    persistenceEnabled: () => false,
    persistenceStatus: () => ({ pendingWrites: 0, lastSuccessAt: null, lastErrorAt: null }),
    reconnect: async () => ({
      code: 'ABC234',
      playerId: 'guest-id',
      room: { code: 'ABC234' },
      supersededSocketId: null
    }),
    roomViews: () => [],
    activeTimer: () => null,
    hostPromotionDelay: () => promotionDelay,
    maybePromoteHost: async () => {
      promotionChecks += 1;
      promotionDelay = 0;
      return false;
    },
    disconnect: () => null,
    pruneInactiveRooms: async () => {},
    flushPersistence: async () => {}
  };
  const server = createAppServer({ store });
  const address = await server.start(0);
  const socket = await connect(`http://127.0.0.1:${address.port}`);

  try {
    const response = await request(socket, 'room:reconnect', {
      code: 'ABC234',
      sessionToken: 'token'
    });
    assert.equal(response.ok, true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(promotionChecks, 1);
  } finally {
    socket.disconnect();
    await server.stop();
  }
});

test('graceful shutdown flushes state queued by socket disconnects', async () => {
  const order = [];
  const store = {
    persistenceEnabled: () => false,
    persistenceStatus: () => ({ pendingWrites: 0, lastSuccessAt: null, lastErrorAt: null }),
    disconnect: () => {
      order.push('disconnect');
      return null;
    },
    pruneInactiveRooms: async () => {},
    flushPersistence: async () => {
      order.push('flush');
    }
  };
  const server = createAppServer({ store });
  const address = await server.start(0);
  const socket = await connect(`http://127.0.0.1:${address.port}`);

  await server.stop();
  assert.deepEqual(order, ['disconnect', 'flush']);
  socket.disconnect();
});
