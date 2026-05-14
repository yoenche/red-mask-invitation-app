import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import type { ShowControlEvent } from './showControl';

export const SHOW_CONTROL_CHANNEL = 'red-mask-show-control';

export const AUDIENCE_STATUSES = [
  'WAITING',
  'CAMERA_GRANTED',
  'VIDEO_READY',
  'READY',
  'PLAYING',
  'RESULT',
  'CAMERA_DENIED'
] as const;

export type AudienceStatus = (typeof AUDIENCE_STATUSES)[number];

export type ShowControlPayload = {
  event: ShowControlEvent;
  sentAt: string;
  startAt?: number;
  type: ShowControlEvent;
};

export type AudiencePresence = {
  audienceId: string;
  status: AudienceStatus;
  updatedAt: string;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
const hasUsableSupabaseEnv = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl !== 'your_supabase_project_url' &&
    supabaseAnonKey !== 'your_supabase_anon_key' &&
    /^https?:\/\//.test(supabaseUrl)
);

export const SUPABASE_DEVELOPMENT_WARNING =
  'Supabase is not configured. Add valid VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY values to .env to enable realtime show control.';

export const supabase = hasUsableSupabaseEnv && supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 10
        }
      }
    })
  : null;

export const isSupabaseConfigured = supabase !== null;

if (!isSupabaseConfigured && import.meta.env.DEV) {
  console.warn(SUPABASE_DEVELOPMENT_WARNING);
}

export function getSupabaseDevelopmentWarning() {
  return isSupabaseConfigured ? null : SUPABASE_DEVELOPMENT_WARNING;
}

export function createShowControlChannel(presenceKey?: string) {
  if (!supabase) {
    return null;
  }

  const channelOptions = {
    config: {
      broadcast: {
        self: false
      }
    }
  };

  if (!presenceKey) {
    return supabase.channel(SHOW_CONTROL_CHANNEL, channelOptions);
  }

  return supabase.channel(SHOW_CONTROL_CHANNEL, {
    config: {
      ...channelOptions.config,
      presence: {
        key: presenceKey
      }
    }
  });
}

export async function broadcastShowControlEvent(
  channel: RealtimeChannel,
  event: ShowControlEvent,
  payload?: Partial<Omit<ShowControlPayload, 'event' | 'sentAt' | 'type'>>
) {
  return channel.send({
    type: 'broadcast',
    event,
    payload: {
      event,
      sentAt: new Date().toISOString(),
      type: event,
      ...payload
    } satisfies ShowControlPayload
  });
}

export function onShowControlEvent(
  channel: RealtimeChannel,
  handler: (payload: ShowControlPayload) => void
) {
  (['START', 'RESET', 'EMERGENCY_STOP'] as const).forEach((event) => {
    channel.on('broadcast', { event }, ({ payload }) => {
      handler(payload as ShowControlPayload);
    });
  });

  return channel;
}

export async function trackAudienceStatus(
  channel: RealtimeChannel,
  audienceId: string,
  status: AudienceStatus
) {
  return channel.track({
    audienceId,
    status,
    updatedAt: new Date().toISOString()
  } satisfies AudiencePresence);
}
