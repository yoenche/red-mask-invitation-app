import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

/** Documented API actions. `VERIFY` is used only by the admin UI to check the PIN without mutating state. */
type ShowControlAction = 'START' | 'RESET' | 'EMERGENCY_STOP' | 'VERIFY';
type ShowControlState = 'WAITING' | 'PLAYING' | 'STOPPED';

type ShowControlRequestBody = {
  action?: string;
  pin?: string;
};

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*'
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    },
    status
  });
}

function isShowControlAction(action: unknown): action is ShowControlAction {
  return (
    action === 'START' ||
    action === 'RESET' ||
    action === 'EMERGENCY_STOP' ||
    action === 'VERIFY'
  );
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Only POST requests are allowed.' }, 405);
  }

  const adminPin = Deno.env.get('ADMIN_PIN');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!adminPin || !supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      {
        error:
          'Edge Function is missing required secrets. Set ADMIN_PIN, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY for this function.'
      },
      500
    );
  }

  let body: ShowControlRequestBody;

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON.' }, 400);
  }

  if (!isShowControlAction(body.action)) {
    return jsonResponse(
      {
        error:
          'Invalid action. Use "START", "RESET", or "EMERGENCY_STOP" (or "VERIFY" for PIN checks from the admin UI).'
      },
      400
    );
  }

  if (typeof body.pin !== 'string' || body.pin !== adminPin) {
    return jsonResponse({ error: 'Invalid PIN.' }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false
    }
  });

  if (body.action === 'VERIFY') {
    const { data, error } = await supabase
      .from('show_control')
      .select('id,state,start_at,updated_at')
      .eq('id', 'main')
      .maybeSingle();

    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    if (!data) {
      return jsonResponse(
        { error: 'No show_control row with id "main". Run the database migration or insert script first.' },
        500
      );
    }

    return jsonResponse(data);
  }

  const now = new Date();
  let state: ShowControlState;
  let startAt: string | null = null;

  if (body.action === 'START') {
    state = 'PLAYING';
    startAt = new Date(now.getTime() + 3000).toISOString();
  } else if (body.action === 'RESET') {
    state = 'WAITING';
  } else {
    state = 'STOPPED';
  }

  const { data, error } = await supabase
    .from('show_control')
    .upsert(
      {
        id: 'main',
        start_at: startAt,
        state,
        updated_at: now.toISOString()
      },
      {
        onConflict: 'id'
      }
    )
    .select('id,state,start_at,updated_at')
    .single();

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse(data);
});
