import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomRepository } from './roomRepository.js';

const createFakeSupabase = (initialOutcomes = []) => {
  const outcomes = [...initialOutcomes];
  const calls = [];

  return {
    calls,
    queue(...nextOutcomes) {
      outcomes.push(...nextOutcomes);
    },
    from(table) {
      const call = { table, operation: 'select' };
      const query = {
        upsert(payload, options) {
          call.operation = 'upsert';
          call.payload = structuredClone(payload);
          call.options = options;
          return query;
        },
        delete() {
          call.operation = 'delete';
          return query;
        },
        select(fields) {
          call.fields = fields;
          return query;
        },
        eq(field, value) {
          call.eq = [field, value];
          return query;
        },
        lt(field, value) {
          call.lt = [field, value];
          return query;
        },
        not(field, operator, value) {
          call.not = [field, operator, value];
          return query;
        },
        limit(value) {
          call.limit = value;
          return query;
        },
        abortSignal(signal) {
          call.signal = signal;
          return query;
        },
        single() {
          call.single = true;
          return query;
        },
        maybeSingle() {
          call.maybeSingle = true;
          return query;
        },
        then(resolve, reject) {
          calls.push(call);
          const outcome = outcomes.length
            ? outcomes.shift()
            : { data: null, error: null };
          return Promise.resolve(typeof outcome === 'function' ? outcome(call) : outcome).then(resolve, reject);
        }
      };
      return query;
    }
  };
};

const quietLogger = { warn() {} };

test('rename retires an old failed write instead of recreating its row', async () => {
  const supabase = createFakeSupabase([{ data: null, error: new Error('offline') }]);
  const repository = createRoomRepository({ supabase, retryBaseMs: 10000, logger: quietLogger });
  repository.saveRoom({ code: 'OLD234', version: 1 });
  await waitFor(() => repository.getStatus().retryScheduledAt);
  repository.renameRoom('OLD234', { code: 'NEW234', version: 2 });
  await repository.flush();
  assert.deepEqual(supabase.calls.filter((call) => call.operation === 'upsert')
    .map((call) => call.payload.code), ['OLD234', 'NEW234']);
  assert.equal(repository.getStatus().pendingWrites, 0);
});

test('rename during an in-flight failure retains only the latest code and snapshot', async () => {
  let release;
  const supabase = createFakeSupabase([() => new Promise((resolve) => { release = resolve; })]);
  const repository = createRoomRepository({ supabase, logger: quietLogger });
  repository.saveRoom({ code: 'OLD234', version: 1 });
  await waitFor(() => release);
  assert.equal(repository.getStatus().pendingWrites, 1);
  repository.renameRoom('OLD234', { code: 'MID234', version: 2 });
  repository.renameRoom('MID234', { code: 'NEW234', version: 3 });
  repository.saveRoom({ code: 'NEW234', version: 4 });
  release({ data: null, error: new Error('offline') });
  await repository.flush();
  assert.deepEqual(supabase.calls.filter((call) => call.operation === 'upsert')
    .map((call) => [call.payload.code, call.payload.state.version]), [['OLD234', 1], ['NEW234', 4]]);
  assert.deepEqual(supabase.calls.filter((call) => call.operation === 'delete')
    .map((call) => call.eq[1]), ['OLD234', 'MID234']);
  assert.equal(repository.getStatus().pendingWrites, 0);
});

const waitFor = async (predicate, timeoutMs = 500) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for repository work');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

test('disabled repository remains an immediate no-op', async () => {
  const repository = createRoomRepository();
  repository.saveRoom({ code: 'ABC234', version: 1 });
  await repository.flush();
  assert.equal(repository.isEnabled(), false);
  assert.equal(repository.getStatus().pendingWrites, 0);
});

test('queued writes coalesce to the newest room snapshot', async () => {
  const supabase = createFakeSupabase([{ data: { code: 'ABC234' }, error: null }]);
  const repository = createRoomRepository({ supabase, logger: quietLogger });

  repository.saveRoom({ code: 'ABC234', version: 1 });
  repository.saveRoom({ code: 'ABC234', version: 2 });
  await repository.flush();

  assert.equal(supabase.calls.length, 1);
  assert.equal(supabase.calls[0].operation, 'upsert');
  assert.equal(supabase.calls[0].payload.state.version, 2);
  assert.equal(repository.getStatus().pendingWrites, 0);
});

test('failed writes retry and eventually clear pending state', async () => {
  const supabase = createFakeSupabase([
    { data: null, error: new Error('temporary outage') },
    { data: { code: 'ABC234' }, error: null }
  ]);
  const repository = createRoomRepository({
    supabase,
    retryBaseMs: 5,
    retryMaxMs: 5,
    logger: quietLogger
  });

  repository.saveRoom({ code: 'ABC234', version: 1 });
  await waitFor(() => supabase.calls.length === 2);
  await waitFor(() => repository.getStatus().pendingWrites === 0);

  assert.ok(repository.getStatus().lastErrorAt);
  assert.ok(repository.getStatus().lastSuccessAt);
});

test('newer state supersedes a failed snapshot without losing retry', async () => {
  const supabase = createFakeSupabase([
    { data: null, error: new Error('temporary outage') },
    { data: { code: 'ABC234' }, error: null }
  ]);
  const repository = createRoomRepository({
    supabase,
    retryBaseMs: 1000,
    logger: quietLogger
  });

  repository.saveRoom({ code: 'ABC234', version: 1 });
  await waitFor(() => supabase.calls.length === 1);
  repository.saveRoom({ code: 'ABC234', version: 2 });
  await repository.flush();

  assert.equal(supabase.calls.length, 2);
  assert.equal(supabase.calls[1].payload.state.version, 2);
  assert.equal(repository.getStatus().pendingWrites, 0);
});

test('rename retries until both new snapshot save and old row deletion succeed', async () => {
  const supabase = createFakeSupabase([
    { data: { code: 'NEW234' }, error: null },
    { data: null, error: new Error('delete failed') },
    { data: { code: 'NEW234' }, error: null },
    { data: null, error: null }
  ]);
  const repository = createRoomRepository({
    supabase,
    retryBaseMs: 1000,
    logger: quietLogger
  });

  repository.renameRoom('OLD234', { code: 'NEW234', version: 1 });
  await waitFor(() => supabase.calls.length === 2);
  assert.equal(repository.getStatus().pendingWrites, 1);
  await repository.flush();

  assert.deepEqual(supabase.calls.map((call) => call.operation), ['upsert', 'delete', 'upsert', 'delete']);
  assert.deepEqual(supabase.calls[3].eq, ['code', 'OLD234']);
  assert.equal(repository.getStatus().pendingWrites, 0);
});

test('flush makes one final attempt and returns when persistence stays unavailable', async () => {
  const supabase = createFakeSupabase([
    { data: null, error: new Error('outage') },
    { data: null, error: new Error('still unavailable') }
  ]);
  const repository = createRoomRepository({
    supabase,
    retryBaseMs: 1000,
    logger: quietLogger
  });

  repository.saveRoom({ code: 'ABC234', version: 1 });
  await waitFor(() => supabase.calls.length === 1);
  await repository.flush();

  assert.equal(supabase.calls.length, 2);
  assert.equal(repository.getStatus().pendingWrites, 1);
});
