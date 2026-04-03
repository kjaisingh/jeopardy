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

const throwIfDisabled = () => {
  if (!persistenceEnabled) {
    throw new Error('Supabase persistence is not configured');
  }
};

const unwrap = (result, action) => {
  if (result.error) {
    throw new Error(`Failed to ${action}: ${result.error.message}`);
  }

  return result.data;
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
    if (!persistenceEnabled) return null;

    const data = unwrap(
      await supabase
        .from('rooms')
        .select('state')
        .eq('code', code)
        .maybeSingle(),
      `load room ${code}`
    );

    return data?.state || null;
  },

  async roomExists(code) {
    if (!persistenceEnabled) return false;

    const data = unwrap(
      await supabase
        .from('rooms')
        .select('code')
        .eq('code', code)
        .maybeSingle(),
      `check room ${code}`
    );

    return Boolean(data);
  },

  async saveRoom(roomState) {
    if (!persistenceEnabled) return;

    unwrap(
      await supabase
        .from('rooms')
        .upsert(
          {
            code: roomState.code,
            state: roomState
          },
          { onConflict: 'code' }
        )
        .select('code')
        .single(),
      `save room ${roomState.code}`
    );
  },

  async renameRoom(previousCode, roomState) {
    throwIfDisabled();

    unwrap(
      await supabase
        .from('rooms')
        .update({
          code: roomState.code,
          state: roomState
        })
        .eq('code', previousCode)
        .select('code')
        .single(),
      `rename room ${previousCode} to ${roomState.code}`
    );
  }
};
