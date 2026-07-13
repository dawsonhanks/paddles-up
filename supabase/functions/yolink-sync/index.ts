import { createClient } from 'npm:@supabase/supabase-js@2'

const YOLINK_TOKEN_URL = 'https://api.yosmart.com/open/yolink/token'
const YOLINK_API_URL = 'https://api.yosmart.com/open/yolink/v2/api'
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000
/** Keep court marked in-use briefly after motion stops before flipping to available. */
const NO_MOTION_GRACE_PERIOD_SECONDS = 180
// Cron polls once per minute, so the transition to "available" can take up to
// grace period + ~1 poll interval (e.g. ~4 min worst case with 180s grace).

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type CourtSensor = {
  id: string
  court_id: string | null
  zone_id: string | null
  device_id: string
  device_token: string
  is_active: boolean
}

type SyncResult = {
  device_id: string
  court_id: string | null
  is_active: boolean
}

type YoLinkTokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
}

type YoLinkStateResponse = {
  data?: {
    state?: {
      state?: string
      stateChangedAt?: number
    }
    reportAt?: string
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isTokenValid(expiresAt: string | null): boolean {
  if (!expiresAt) return false
  const expiresMs = new Date(expiresAt).getTime()
  return expiresMs > Date.now() + TOKEN_EXPIRY_BUFFER_MS
}

async function fetchYoLinkToken(uaid: string, secretKey: string): Promise<YoLinkTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: uaid,
    client_secret: secretKey,
  })

  const res = await fetch(YOLINK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`YoLink token request failed (${res.status}): ${text}`)
  }

  return (await res.json()) as YoLinkTokenResponse
}

async function getAccessToken(
  supabase: ReturnType<typeof createClient>,
  uaid: string,
  secretKey: string,
): Promise<string> {
  const { data: authRow, error: authErr } = await supabase
    .from('yolink_auth')
    .select('access_token, expires_at')
    .eq('id', 1)
    .maybeSingle()

  if (authErr) {
    throw new Error(`Failed to read yolink_auth: ${authErr.message}`)
  }

  if (authRow?.access_token && isTokenValid(authRow.expires_at)) {
    return authRow.access_token
  }

  const tokenData = await fetchYoLinkToken(uaid, secretKey)
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()

  const { error: upsertErr } = await supabase.from('yolink_auth').upsert({
    id: 1,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  })

  if (upsertErr) {
    throw new Error(`Failed to cache YoLink token: ${upsertErr.message}`)
  }

  return tokenData.access_token
}

async function fetchMotionSensorState(
  accessToken: string,
  deviceId: string,
  deviceToken: string,
): Promise<YoLinkStateResponse> {
  const res = await fetch(YOLINK_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      method: 'MotionSensor.getState',
      targetDevice: deviceId,
      token: deviceToken,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`YoLink API request failed for ${deviceId} (${res.status}): ${text}`)
  }

  return (await res.json()) as YoLinkStateResponse
}

function occupancyIsActive(sensorState: string | undefined, stateChangedAt: number | undefined): boolean {
  if (sensorState === 'alert') {
    return true
  }
  if (sensorState === 'normal' && stateChangedAt != null) {
    const secondsSinceNormal = (Date.now() - stateChangedAt) / 1000
    return secondsSinceNormal < NO_MOTION_GRACE_PERIOD_SECONDS
  }
  return false
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const uaid = Deno.env.get('YOLINK_UAID')
    const secretKey = Deno.env.get('YOLINK_SECRET_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!uaid || !secretKey) {
      return jsonResponse({ error: 'YoLink credentials not configured' }, 500)
    }
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'Supabase configuration missing' }, 500)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const accessToken = await getAccessToken(supabase, uaid, secretKey)

    const { data: sensors, error: sensorsErr } = await supabase
      .from('court_sensors')
      .select('id, court_id, zone_id, device_id, device_token, is_active')
      .eq('device_type', 'MotionSensor')

    if (sensorsErr) {
      return jsonResponse({ error: `Failed to load court_sensors: ${sensorsErr.message}` }, 500)
    }

    const updated: SyncResult[] = []
    const now = new Date().toISOString()

    for (const sensor of (sensors ?? []) as CourtSensor[]) {
      try {
        const rawState = await fetchMotionSensorState(
          accessToken,
          sensor.device_id,
          sensor.device_token,
        )

        const state = rawState.data?.state?.state
        const stateChangedAt = rawState.data?.state?.stateChangedAt
        const isActive = occupancyIsActive(state, stateChangedAt)
        const previousIsActive = sensor.is_active === true
        const statusChanged = isActive !== previousIsActive
        const eventOccurredAt = stateChangedAt != null
          ? new Date(stateChangedAt).toISOString()
          : now

        const { error: updateErr } = await supabase
          .from('court_sensors')
          .update({
            is_active: isActive,
            last_event_at: stateChangedAt != null
              ? new Date(stateChangedAt).toISOString()
              : null,
            last_synced_at: now,
            raw_last_state: rawState,
          })
          .eq('id', sensor.id)

        if (updateErr) {
          throw new Error(updateErr.message)
        }

        if (statusChanged && sensor.court_id) {
          const { error: eventErr } = await supabase.from('court_status_events').insert({
            court_id: sensor.court_id,
            zone_id: sensor.zone_id,
            status: isActive ? 'busy' : 'available',
            source: 'sensor',
            occurred_at: eventOccurredAt,
          })

          if (eventErr) {
            throw new Error(`Failed to log court_status_event: ${eventErr.message}`)
          }
        }

        updated.push({
          device_id: sensor.device_id,
          court_id: sensor.court_id,
          is_active: isActive,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`Failed to sync sensor ${sensor.device_id}:`, msg)
      }
    }

    return jsonResponse({ updated, count: updated.length })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('yolink-sync failed:', msg)
    return jsonResponse({ error: msg }, 500)
  }
})
