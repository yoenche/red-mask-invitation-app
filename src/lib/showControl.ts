import type { RealtimeChannel } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './supabase';

export const SHOW_CONTROL_TABLE = 'show_control';
export const SHOW_CONTROL_ROW_ID = 'main';

export const SHOW_CONTROL_EVENTS = ['START', 'RESET', 'EMERGENCY_STOP'] as const;
export type ShowControlEvent = (typeof SHOW_CONTROL_EVENTS)[number];
export type ShowControlFunctionAction = ShowControlEvent | 'VERIFY';

export const SHOW_CONTROL_STATES = ['WAITING', 'PLAYING', 'STOPPED'] as const;
export type ShowControlState = (typeof SHOW_CONTROL_STATES)[number];

/** Row shape aligned with `public.show_control` (snake_case). Used across Realtime and UI. */
export type ShowControlRow = {
  id: string;
  start_at: string | null;
  state: ShowControlState;
  updated_at: string;
};

/** Normalized camelCase view of the same row (optional for app code). */
export type ShowControlRowCamel = {
  id: string;
  startAt: string | null;
  state: ShowControlState;
  updatedAt: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isShowControlState(value: unknown): value is ShowControlState {
  return typeof value === 'string' && SHOW_CONTROL_STATES.includes(value as ShowControlState);
}

function unwrapRowCandidate(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.id === 'string' && isShowControlState(value.state)) {
    return value;
  }

  return null;
}

/**
 * Pulls a single `show_control`-shaped object out of various Edge Function / API response wrappers.
 */
export function extractShowControlRowPayload(body: unknown): Record<string, unknown> | null {
  if (!isRecord(body)) {
    return null;
  }

  const tries: unknown[] = [];

  if (body.show_control != null) {
    tries.push(body.show_control);
  }

  if (body.showControl != null) {
    const sc = body.showControl;
    if (isRecord(sc) && sc.show_control != null) {
      tries.push(sc.show_control);
    }
    tries.push(sc);
  }

  if (body.data != null) {
    tries.push(body.data);
    if (isRecord(body.data)) {
      const d = body.data;
      if (d.show_control != null) {
        tries.push(d.show_control);
      }
      if (d.showControl != null) {
        const dc = d.showControl;
        if (isRecord(dc) && dc.show_control != null) {
          tries.push(dc.show_control);
        }
        tries.push(dc);
      }
    }
  }

  if (body.row != null) {
    tries.push(body.row);
  }

  for (const candidate of tries) {
    const row = unwrapRowCandidate(candidate);
    if (row) {
      return row;
    }
  }

  return unwrapRowCandidate(body);
}

/**
 * Maps API/DB fields (snake_case or camelCase) into the canonical `ShowControlRow` used in the app.
 */
export function normalizeShowControlRow(raw: unknown): ShowControlRow | null {
  const obj = extractShowControlRowPayload(raw);
  if (!obj) {
    return null;
  }

  const id = typeof obj.id === 'string' ? obj.id : null;
  const state = obj.state;

  if (!id || !isShowControlState(state)) {
    return null;
  }

  let start_at: string | null = null;
  if ('start_at' in obj) {
    const v = obj.start_at;
    if (v === null) {
      start_at = null;
    } else if (typeof v === 'string') {
      start_at = v;
    }
  } else if ('startAt' in obj) {
    const v = obj.startAt;
    if (v === null) {
      start_at = null;
    } else if (typeof v === 'string') {
      start_at = v;
    }
  }

  let updated_at: string | null = null;
  if ('updated_at' in obj && typeof obj.updated_at === 'string') {
    updated_at = obj.updated_at;
  } else if ('updatedAt' in obj && typeof obj.updatedAt === 'string') {
    updated_at = obj.updatedAt;
  }

  if (!updated_at) {
    return null;
  }

  return {
    id,
    start_at,
    state,
    updated_at
  };
}

export function showControlRowToCamel(row: ShowControlRow): ShowControlRowCamel {
  return {
    id: row.id,
    startAt: row.start_at,
    state: row.state,
    updatedAt: row.updated_at
  };
}

export function showControlRowFromCamel(row: ShowControlRowCamel): ShowControlRow {
  return {
    id: row.id,
    start_at: row.startAt,
    state: row.state,
    updated_at: row.updatedAt
  };
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
        const row = normalizeShowControlRow(payload.new) ?? (payload.new as ShowControlRow);
        handler(row);
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

  const normalized = data ? normalizeShowControlRow(data) : null;

  return {
    data: (normalized ?? (data as ShowControlRow | null)) as ShowControlRow | null,
    error
  };
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

    const row = normalizeShowControlRow(responseBody);

    if (!row) {
      console.error('[show-control] unexpected response body:', responseBody);
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
