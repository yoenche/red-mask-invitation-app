import type { RealtimeChannel } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './supabase';

export const SHOW_CONTROL_TABLE = 'show_control';
export const SHOW_CONTROL_ROW_ID = 'main';

export const SHOW_CONTROL_EVENTS = ['START', 'RESET', 'EMERGENCY_STOP'] as const;
export type ShowControlEvent = (typeof SHOW_CONTROL_EVENTS)[number];
export type ShowControlFunctionAction = ShowControlEvent | 'VERIFY';

export const SHOW_CONTROL_STATES = ['WAITING', 'PLAYING', 'STOPPED'] as const;
export type ShowControlState = (typeof SHOW_CONTROL_STATES)[number];

export type ShowControlRow = {
  id: string;
  start_at: string | null;
  state: ShowControlState;
  updated_at: string;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

/** `${VITE_SUPABASE_URL}/functions/v1/show-control` with trailing slashes stripped from the base URL. */
export function getShowControlEdgeFunctionUrl() {
  const base = (supabaseUrl ?? '').replace(/\/+$/, '');
  if (!base) {
    return '';
  }
  return `${base}/functions/v1/show-control`;
}

export function onShowControlRowChange(
  channel: RealtimeChannel,
  handler: (row: ShowControlRow) => void
) {
  channel.on(
    'postgres_changes',
    {
      event: '*',
      filter: `id=eq.${SHOW_CONTROL_ROW_ID}`,
      schema: 'public',
      table: SHOW_CONTROL_TABLE
    },
    (payload) => {
      if ('new' in payload && payload.new) {
        handler(payload.new as ShowControlRow);
      }
    }
  );

  return channel;
}

export async function fetchShowControlRow() {
  if (!supabase) {
    return {
      data: null,
      error: new Error('Supabase is not configured.')
    };
  }

  const { data, error } = await supabase
    .from(SHOW_CONTROL_TABLE)
    .select('id,state,start_at,updated_at')
    .eq('id', SHOW_CONTROL_ROW_ID)
    .maybeSingle();

  return {
    data: data as ShowControlRow | null,
    error
  };
}

function parseShowControlResponseBody(responseBody: unknown): ShowControlRow | null {
  if (!responseBody || typeof responseBody !== 'object') {
    return null;
  }

  if ('row' in responseBody && responseBody.row && typeof responseBody.row === 'object') {
    return responseBody.row as ShowControlRow;
  }

  if (
    'id' in responseBody &&
    'state' in responseBody &&
    typeof (responseBody as { id: unknown }).id === 'string'
  ) {
    return responseBody as ShowControlRow;
  }

  return null;
}

export async function callShowControlFunction(pin: string, action: ShowControlFunctionAction) {
  const functionUrl = getShowControlEdgeFunctionUrl();

  if (!functionUrl || !supabaseAnonKey || !isSupabaseConfigured) {
    return {
      data: null,
      error: new Error('Supabase is not configured.'),
      status: 0
    };
  }

  try {
    const response = await fetch(functionUrl, {
      body: JSON.stringify({
        action,
        pin
      }),
      headers: {
        Authorization: `Bearer ${supabaseAnonKey}`,
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json'
      },
      method: 'POST'
    });

    const responseBody = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        responseBody &&
        typeof responseBody === 'object' &&
        'error' in responseBody &&
        typeof responseBody.error === 'string'
          ? responseBody.error
          : `show-control failed with ${response.status}`;
      return {
        data: null,
        error: new Error(message),
        status: response.status
      };
    }

    const row = parseShowControlResponseBody(responseBody);

    if (!row) {
      return {
        data: null,
        error: new Error('show-control returned an unexpected response body.'),
        status: response.status
      };
    }

    return {
      data: row,
      error: null,
      status: response.status
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error : new Error('show-control request failed.'),
      status: 0
    };
  }
}

export function getShowControlStartAtMs(row: Pick<ShowControlRow, 'start_at'>) {
  if (!row.start_at) {
    return undefined;
  }

  const startAt = Date.parse(row.start_at);
  return Number.isFinite(startAt) ? startAt : undefined;
}
