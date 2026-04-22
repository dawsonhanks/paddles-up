export type GeocodeResult = {
  latitude: number
  longitude: number
  source: string
  confidence: string
}

function confidenceFromImportance(importance: unknown): string {
  if (typeof importance !== 'number' || !Number.isFinite(importance)) return 'unknown'
  if (importance >= 0.7) return 'high'
  if (importance >= 0.4) return 'medium'
  return 'low'
}

export async function geocodeAddress(input: {
  address: string
  city: string
  state?: string | null
}): Promise<GeocodeResult> {
  const query = [input.address, input.city, input.state].filter(Boolean).join(', ')
  if (!query.trim()) {
    throw new Error('Address, city, and/or state are required for geocoding.')
  }

  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '1')
  url.searchParams.set('addressdetails', '0')

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Geocoding failed with status ${response.status}.`)
  }

  const rows = (await response.json()) as Array<{ lat?: string; lon?: string; importance?: number }>
  const row = rows?.[0]
  const lat = row?.lat ? Number(row.lat) : Number.NaN
  const lon = row?.lon ? Number(row.lon) : Number.NaN

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('Could not find coordinates for that address.')
  }

  return {
    latitude: lat,
    longitude: lon,
    source: 'nominatim',
    confidence: confidenceFromImportance(row.importance),
  }
}
