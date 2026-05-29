/**
 * One-off: re-geocode public.courts from address via Nominatim (1 req/s).
 * Usage: node scripts/geocode-courts.mjs [--dry-run]
 * Requires EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
 * (or pass via env). Falls back to printing SQL if no service key.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

function loadEnv() {
  const envPath = resolve(process.cwd(), '.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m || process.env[m[1]] != null) continue
    let v = m[2].trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    process.env[m[1]] = v
  }
}

loadEnv()

const dryRun = process.argv.includes('--dry-run')
const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

async function geocodeAddress(address) {
  const q = address?.trim()
  if (!q) throw new Error('empty address')

  const search = new URL('https://nominatim.openstreetmap.org/search')
  search.searchParams.set('q', q)
  search.searchParams.set('format', 'jsonv2')
  search.searchParams.set('limit', '1')
  search.searchParams.set('addressdetails', '0')

  const response = await fetch(search.toString(), {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'PaddlesUp/1.0 (court coordinate refresh; contact: dawsonhanks)',
    },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const rows = await response.json()
  const row = rows?.[0]
  const lat = row?.lat ? Number(row.lat) : NaN
  const lon = row?.lon ? Number(row.lon) : NaN
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('no result')
  }
  return { latitude: lat, longitude: lon }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function isLowPrecision(lat, lon) {
  const lat4 = Math.round(lat * 1e4) / 1e4
  const lon4 = Math.round(lon * 1e4) / 1e4
  return lat === lat4 && lon === lon4
}

async function main() {
  if (!url) {
    console.error('Missing EXPO_PUBLIC_SUPABASE_URL')
    process.exit(1)
  }

  const supabase = createClient(url, serviceKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY)
  const { data: courts, error } = await supabase
    .from('courts')
    .select('id, name, address, latitude, longitude')
    .order('name')

  if (error) {
    console.error(error.message)
    process.exit(1)
  }

  const updates = []
  for (const court of courts ?? []) {
    const addr = court.address?.trim() ?? ''
    if (!addr || /your court address/i.test(addr)) {
      console.log(`SKIP ${court.name}: invalid address`)
      continue
    }

    if (!isLowPrecision(court.latitude, court.longitude)) {
      console.log(`SKIP ${court.name}: already high precision`)
      continue
    }

    await sleep(1100)
    try {
      const geo = await geocodeAddress(addr)
      const movedM =
        Math.abs(geo.latitude - court.latitude) + Math.abs(geo.longitude - court.longitude)
      updates.push({
        id: court.id,
        name: court.name,
        old: { lat: court.latitude, lon: court.longitude },
        next: geo,
        movedM: movedM * 111000,
      })
      console.log(
        `OK ${court.name}: ${court.latitude},${court.longitude} -> ${geo.latitude},${geo.longitude}`,
      )
    } catch (e) {
      console.log(`FAIL ${court.name}: ${e.message}`)
    }
  }

  if (updates.length === 0) {
    console.log('No updates.')
    return
  }

  if (dryRun) {
    console.log('\n-- dry run SQL:')
    for (const u of updates) {
      console.log(
        `UPDATE public.courts SET latitude = ${u.next.latitude}, longitude = ${u.next.longitude} WHERE id = '${u.id}';`,
      )
    }
    return
  }

  if (!serviceKey) {
    console.error('\nSet SUPABASE_SERVICE_ROLE_KEY to apply updates (courts has no UPDATE RLS for clients).')
    console.log('Or run the SQL printed with --dry-run via Supabase SQL editor.')
    process.exit(1)
  }

  for (const u of updates) {
    const { error: upErr } = await supabase
      .from('courts')
      .update({ latitude: u.next.latitude, longitude: u.next.longitude })
      .eq('id', u.id)
    if (upErr) {
      console.error(`UPDATE failed ${u.name}:`, upErr.message)
      process.exit(1)
    }
  }

  console.log(`\nUpdated ${updates.length} courts.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
