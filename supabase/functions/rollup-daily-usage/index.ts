import { createClient } from 'npm:@supabase/supabase-js@2'

const DENVER_TZ = 'America/Denver'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}


type HourlyRow = {
  hour_bucket: string
  busy_transitions: number
}

type UsageWindow = {
  usage_date: string
  day_start: string
  day_end: string
}

type DailyRollup = {
  court_id: string
  usage_date: string
  busy_minutes: number
  checkin_count: number
  unique_users: number
  peak_hour: number | null
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function denverHour(isoTimestamp: string): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: DENVER_TZ,
    hour: 'numeric',
    hour12: false,
  }).format(new Date(isoTimestamp))
  return Number(hour)
}

function computeBusyMinutes(
  events: Array<{ status: string; occurred_at: string }>,
  dayStartMs: number,
  dayEndMs: number,
): number {
  let totalMs = 0
  let busyStartMs: number | null = null

  for (const event of events) {
    const atMs = new Date(event.occurred_at).getTime()
    if (atMs >= dayStartMs) break
    if (event.status === 'busy') {
      busyStartMs = dayStartMs
    } else if (event.status === 'available') {
      busyStartMs = null
    }
  }

  for (const event of events) {
    const atMs = new Date(event.occurred_at).getTime()
    if (atMs < dayStartMs) continue
    if (atMs >= dayEndMs) break

    if (event.status === 'busy') {
      if (busyStartMs == null) {
        busyStartMs = atMs
      }
      continue
    }

    if (event.status === 'available' && busyStartMs != null) {
      const endMs = Math.min(atMs, dayEndMs)
      if (endMs > busyStartMs) {
        totalMs += endMs - busyStartMs
      }
      busyStartMs = null
    }
  }

  if (busyStartMs != null && dayEndMs > busyStartMs) {
    totalMs += dayEndMs - busyStartMs
  }

  return Math.round(totalMs / 60_000)
}

function peakHourFromHourly(rows: HourlyRow[]): number | null {
  if (rows.length === 0) return null

  let bestHour: number | null = null
  let bestCount = -1

  for (const row of rows) {
    const count = Number(row.busy_transitions ?? 0)
    if (count > bestCount) {
      bestCount = count
      bestHour = denverHour(row.hour_bucket)
    }
  }

  return bestHour
}

async function getUsageWindow(
  supabase: ReturnType<typeof createClient>,
): Promise<UsageWindow> {
  const { data, error } = await supabase.rpc('court_usage_denver_yesterday_window').maybeSingle()

  if (error || !data) {
    throw new Error(`Failed to resolve Denver yesterday window: ${error?.message ?? 'no data'}`)
  }

  const row = data as UsageWindow
  return {
    usage_date: String(row.usage_date),
    day_start: String(row.day_start),
    day_end: String(row.day_end),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'Supabase configuration missing' }, 500)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { usage_date: usageDate, day_start: dayStart, day_end: dayEnd } =
      await getUsageWindow(supabase)

    const dayStartMs = new Date(dayStart).getTime()
    const dayEndMs = new Date(dayEnd).getTime()

    const { data: dayEvents, error: dayEventsErr } = await supabase
      .from('court_status_events')
      .select('court_id')
      .gte('occurred_at', dayStart)
      .lt('occurred_at', dayEnd)

    if (dayEventsErr) {
      return jsonResponse({ error: `Failed to load day events: ${dayEventsErr.message}` }, 500)
    }

    const courtIds = [
      ...new Set(
        (dayEvents ?? [])
          .map((row) => (row as { court_id?: string }).court_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ]

    const rollups: DailyRollup[] = []

    for (const courtId of courtIds) {
      const { data: events, error: eventsErr } = await supabase
        .from('court_status_events')
        .select('status, occurred_at')
        .eq('court_id', courtId)
        .lt('occurred_at', dayEnd)
        .order('occurred_at', { ascending: true })

      if (eventsErr) {
        console.error(`Failed to load events for court ${courtId}:`, eventsErr.message)
        continue
      }

      const busyMinutes = computeBusyMinutes(events ?? [], dayStartMs, dayEndMs)

      const { count: checkinCount, error: checkinErr } = await supabase
        .from('court_status_events')
        .select('*', { count: 'exact', head: true })
        .eq('court_id', courtId)
        .eq('source', 'checkin')
        .gte('occurred_at', dayStart)
        .lt('occurred_at', dayEnd)

      if (checkinErr) {
        console.error(`Failed to count checkins for court ${courtId}:`, checkinErr.message)
        continue
      }

      const { data: checkins, error: usersErr } = await supabase
        .from('court_checkins')
        .select('user_id')
        .eq('court_id', courtId)
        .gte('checked_in_at', dayStart)
        .lt('checked_in_at', dayEnd)

      if (usersErr) {
        console.error(`Failed to load checkin users for court ${courtId}:`, usersErr.message)
        continue
      }

      const uniqueUsers = new Set(
        (checkins ?? [])
          .map((row) => (row as { user_id?: string }).user_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ).size

      const { data: hourly, error: hourlyErr } = await supabase
        .from('court_usage_hourly')
        .select('hour_bucket, busy_transitions')
        .eq('court_id', courtId)
        .gte('hour_bucket', dayStart)
        .lt('hour_bucket', dayEnd)

      if (hourlyErr) {
        console.error(`Failed to load hourly usage for court ${courtId}:`, hourlyErr.message)
        continue
      }

      rollups.push({
        court_id: courtId,
        usage_date: usageDate,
        busy_minutes: busyMinutes,
        checkin_count: checkinCount ?? 0,
        unique_users: uniqueUsers,
        peak_hour: peakHourFromHourly((hourly ?? []) as HourlyRow[]),
      })
    }

    if (rollups.length > 0) {
      const { error: upsertErr } = await supabase
        .from('court_usage_daily')
        .upsert(rollups, { onConflict: 'court_id,usage_date' })

      if (upsertErr) {
        return jsonResponse({ error: `Failed to upsert rollups: ${upsertErr.message}` }, 500)
      }
    }

    return jsonResponse({
      usage_date: usageDate,
      courts_processed: rollups.length,
      rollups,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('rollup-daily-usage failed:', msg)
    return jsonResponse({ error: msg }, 500)
  }
})
