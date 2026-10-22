import { createClient } from '@supabase/supabase-js';
import { positiveInteger, positiveIntegerFromEnv } from './config.js';

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_RETRY_BASE_MS = 1000;
const DEFAULT_RETRY_MAX_MS = 30000;

export function createRoomRepository({
  supabase = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryBaseMs = DEFAULT_RETRY_BASE_MS,
  retryMaxMs = DEFAULT_RETRY_MAX_MS,
  logger = console,
  now = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
} = {}) {
  const persistenceEnabled = Boolean(supabase);
  const operationTimeoutMs = positiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS);
  const initialRetryMs = positiveInteger(retryBaseMs, DEFAULT_RETRY_BASE_MS);
  const maximumRetryMs = Math.max(
    initialRetryMs,
    positiveInteger(retryMaxMs, DEFAULT_RETRY_MAX_MS)
  );
  const pending = new Map();
  const inFlight = new Map();
  const retired = new Set();
  let drainPromise = null;
  let retryTimer = null;
  let retryScheduledAt = null;
  let lastSuccessAt = null;
  let lastErrorAt = null;

  const timestamp = () => new Date(now()).toISOString();

  const withTimeout = async (promise, action, controller) => {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeoutFn(() => {
            controller.abort();
            reject(new Error(`${action} timed out after ${operationTimeoutMs}ms`));
          }, operationTimeoutMs);
          timer?.unref?.();
        })
      ]);
    } finally {
      clearTimeoutFn(timer);
    }
  };

  const safeCall = async (action, fallback, run) => {
    if (!persistenceEnabled) return { ok: false, data: fallback };

    try {
      const controller = new AbortController();
      const result = await withTimeout(Promise.resolve(run(controller.signal)), action, controller);
      if (result.error) throw result.error;
      lastSuccessAt = timestamp();
      return { ok: true, data: result.data };
    } catch (error) {
      lastErrorAt = timestamp();
      logger.warn(`Persistence warning: ${action}: ${error.message}`);
      return { ok: false, data: fallback };
    }
  };

  const persistSnapshot = async ({ state, previousCodes }) => {
    const saved = await safeCall(`save room ${state.code}`, null, (signal) =>
      supabase
        .from('rooms')
        .upsert({ code: state.code, state }, { onConflict: 'code' })
        .select('code')
        .abortSignal(signal)
        .single()
    );
    if (!saved.ok) return false;

    for (const previousCode of previousCodes) {
      const deleted = await safeCall(`delete previous room ${previousCode}`, null, (signal) =>
        supabase.from('rooms').delete().eq('code', previousCode).abortSignal(signal)
      );
      if (!deleted.ok) return false;
      retired.delete(previousCode);
    }

    return true;
  };

  const retryDelay = (attempts) =>
    Math.min(initialRetryMs * (2 ** Math.max(0, attempts - 1)), maximumRetryMs);

  const mergeFailedItem = (code, failedItem) => {
    if (retired.has(code)) return;
    const newerItem = pending.get(code);
    const attempts = failedItem.attempts + 1;
    pending.set(code, {
      state: newerItem?.state || failedItem.state,
      previousCodes: [...new Set([...failedItem.previousCodes, ...(newerItem?.previousCodes || [])])],
      attempts,
      retryAt: now() + retryDelay(attempts)
    });
  };

  const processPending = async (force = false) => {
    const readyCodes = [...pending.entries()]
      .filter(([, item]) => force || item.retryAt <= now())
      .map(([code]) => code);

    for (const code of readyCodes) {
      const item = pending.get(code);
      if (!item || (!force && item.retryAt > now())) continue;
      pending.delete(code);
      inFlight.set(code, item);
      if (!(await persistSnapshot(item))) mergeFailedItem(code, item);
      inFlight.delete(code);
    }
  };

  const clearRetryTimer = () => {
    if (retryTimer) clearTimeoutFn(retryTimer);
    retryTimer = null;
    retryScheduledAt = null;
  };

  const scheduleWork = () => {
    if (!persistenceEnabled || drainPromise || !pending.size) return;
    clearRetryTimer();

    const currentTime = now();
    const earliestRetry = Math.min(...[...pending.values()].map((item) => item.retryAt));
    if (earliestRetry > currentTime) {
      retryScheduledAt = earliestRetry;
      retryTimer = setTimeoutFn(() => {
        retryTimer = null;
        retryScheduledAt = null;
        scheduleWork();
      }, earliestRetry - currentTime);
      retryTimer?.unref?.();
      return;
    }

    drainPromise = Promise.resolve()
      .then(() => processPending())
      .finally(() => {
        drainPromise = null;
        scheduleWork();
      });
  };

  const enqueue = (roomState, previousCode = null) => {
    if (!persistenceEnabled) return;
    const state = structuredClone(roomState);
    const queued = pending.get(state.code);
    const previousItem = pending.get(previousCode) || inFlight.get(previousCode);
    if (previousCode && previousCode !== state.code) {
      retired.add(previousCode);
      pending.delete(previousCode);
    }
    pending.set(state.code, {
      state,
      previousCodes: [...new Set([
        ...(queued?.previousCodes || []),
        ...(previousItem?.previousCodes || []),
        ...(previousCode && previousCode !== state.code ? [previousCode] : [])
      ])],
      attempts: queued?.attempts || 0,
      retryAt: queued?.retryAt || 0
    });
    scheduleWork();
  };

  return {
    isEnabled() {
      return persistenceEnabled;
    },

    getConfigError() {
      if (persistenceEnabled) return null;
      return 'Supabase persistence is disabled. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable durable room saving.';
    },

    getStatus() {
      return {
        pendingWrites: pending.size + inFlight.size,
        retryScheduledAt: retryScheduledAt ? new Date(retryScheduledAt).toISOString() : null,
        lastSuccessAt,
        lastErrorAt
      };
    },

    async loadRoom(code) {
      const result = await safeCall(`load room ${code}`, null, (signal) =>
        supabase.from('rooms').select('state').eq('code', code).abortSignal(signal).maybeSingle()
      );
      return result.data?.state || null;
    },

    async roomExists(code) {
      const result = await safeCall(`check room ${code}`, null, (signal) =>
        supabase.from('rooms').select('code').eq('code', code).abortSignal(signal).maybeSingle()
      );
      return Boolean(result.data);
    },

    saveRoom(roomState) {
      enqueue(roomState);
    },

    renameRoom(previousCode, roomState) {
      enqueue(roomState, previousCode);
    },

    async deleteExpiredRooms(cutoffIso, protectedCodes = []) {
      await safeCall('delete expired rooms', null, (signal) => {
        let query = supabase.from('rooms').delete().lt('updated_at', cutoffIso);
        if (protectedCodes.length) {
          query = query.not('code', 'in', `(${protectedCodes.join(',')})`);
        }
        return query.abortSignal(signal);
      });
    },

    async flush() {
      clearRetryTimer();
      while (drainPromise) await drainPromise;
      if (!pending.size) return;

      clearRetryTimer();
      drainPromise = processPending(true);
      try {
        await drainPromise;
      } finally {
        drainPromise = null;
        scheduleWork();
      }
    }
  };
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;

const retryBaseMs = positiveIntegerFromEnv('PERSISTENCE_RETRY_BASE_MS', DEFAULT_RETRY_BASE_MS);

export const roomRepository = createRoomRepository({
  supabase,
  timeoutMs: positiveIntegerFromEnv('PERSISTENCE_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
  retryBaseMs,
  retryMaxMs: Math.max(
    retryBaseMs,
    positiveIntegerFromEnv('PERSISTENCE_RETRY_MAX_MS', DEFAULT_RETRY_MAX_MS)
  )
});
