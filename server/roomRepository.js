import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const persistenceEnabled = Boolean(supabaseUrl && serviceRoleKey);

const supabase = persistenceEnabled
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

// Persistence is a best-effort durability layer (it lets rooms survive a Render
// free-tier cold restart). A flaky or misconfigured Supabase project must never
// block live gameplay, so every call swallows errors and falls back to
// in-memory-only behavior instead of throwing.
const safeCall = async (action, fallback, run) => {
  if (!persistenceEnabled) return fallback;

  try {
    const result = await run();
    if (result.error) {
      console.warn(`Failed to ${action}: ${result.error.message}`);
      return fallback;
    }
    return result.data;
  } catch (error) {
    console.warn(`Failed to ${action}: ${error.message}`);
    return fallback;
  }
};

export const roomRepository = {
  isEnabled() {
    return persistenceEnabled;
  },

  getConfigError() {
    if (persistenceEnabled) return null;
    return 'Supabase persistence is disabled. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable durable room saving.';
  },

  async loadRoom(code) {
    const data = await safeCall(`load room ${code}`, null, () =>
      supabase.from('rooms').select('state').eq('code', code).maybeSingle()
    );

    return data?.state || null;
  },

  async roomExists(code) {
    const data = await safeCall(`check room ${code}`, null, () =>
      supabase.from('rooms').select('code').eq('code', code).maybeSingle()
    );

    return Boolean(data);
  },

  async saveRoom(roomState) {
    await safeCall(`save room ${roomState.code}`, null, () =>
      supabase
        .from('rooms')
        .upsert(
          {
            code: roomState.code,
            state: roomState
          },
          { onConflict: 'code' }
        )
        .select('code')
        .single()
    );
  },

  async renameRoom(previousCode, roomState) {
    await safeCall(`rename room ${previousCode} to ${roomState.code}`, null, () =>
      supabase
        .from('rooms')
        .update({
          code: roomState.code,
          state: roomState
        })
        .eq('code', previousCode)
        .select('code')
        .single()
    );
  }
};
