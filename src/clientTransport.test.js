import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequest } from './clientTransport.js';
import { EventEmitter } from 'node:events';

test('client transport fails immediately while disconnected', async () => {
  const request = createRequest({ connected: false });
  await assert.rejects(() => request('event', {}), /Not connected/);
});

test('client transport resolves successful acknowledgements', async () => {
  const socket = {
    connected: true,
    once() {}, off() {},
    emit(_event, _payload, acknowledge) {
      acknowledge({ ok: true, value: 42 });
    }
  };
  const request = createRequest(socket);
  assert.deepEqual(await request('event', {}), { ok: true, value: 42 });
});

test('client transport preserves expected server errors', async () => {
  const socket = {
    connected: true,
    once() {}, off() {},
    emit(_event, _payload, acknowledge) {
      acknowledge({ ok: false, message: 'Readable failure' });
    }
  };
  const request = createRequest(socket);
  await assert.rejects(() => request('event', {}), /Readable failure/);
});

test('client transport rejects acknowledgements that exceed the timeout', async () => {
  const socket = { connected: true, emit() {}, once() {}, off() {} };
  const request = createRequest(socket, 5);
  await assert.rejects(() => request('event', {}), /did not respond in time/);
});

test('disconnect rejects pending requests immediately and removes listeners', async () => {
  const socket = new EventEmitter();
  socket.connected = true;
  let acknowledge;
  socket.on('event', (_payload, ack) => { acknowledge = ack; });
  const pending = createRequest(socket)('event', {});
  socket.emit('disconnect');
  await assert.rejects(pending, /Connection lost/);
  assert.equal(socket.listenerCount('disconnect'), 0);
  acknowledge({ ok: true });
});
