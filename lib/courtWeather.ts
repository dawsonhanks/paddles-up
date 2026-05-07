/** Show outdoor forecast only when venue explicitly includes outdoor play. */
export function courtHasOutdoorVenue(indoorOutdoor: string | null): boolean {
  const s = (indoorOutdoor ?? '').toLowerCase().trim()
  if (!s) return false
  return s.includes('outdoor')
}

export type CachedCourtWeather = {
  fetchedAt: number
  temperatureF: number
  weatherCode: number
  windMph: number
}

const CACHE_TTL_MS = 30 * 60 * 1000
const cache = new Map<string, CachedCourtWeather>()

/** Instant read for UI when cache is still fresh (avoids loading flicker). */
export function peekCourtWeatherCache(courtId: string): CachedCourtWeather | null {
  const c = cache.get(courtId)
  if (c == null || Date.now() - c.fetchedAt >= CACHE_TTL_MS) return null
  return c
}

const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast'

function weatherDescription(code: number): string {
  if (code === 0) return 'Clear sky'
  if (code === 1) return 'Mostly clear'
  if (code === 2) return 'Partly cloudy'
  if (code === 3) return 'Overcast'
  if (code === 45 || code === 48) return 'Foggy'
  if (code >= 51 && code <= 57) return 'Drizzle'
  if (code >= 61 && code <= 67) return 'Rain'
  if (code >= 71 && code <= 77) return 'Snow'
  if (code >= 80 && code <= 82) return 'Rain showers'
  if (code >= 85 && code <= 86) return 'Snow showers'
  if (code >= 95 && code <= 99) return 'Thunderstorm'
  return 'Mixed conditions'
}

/** Short label for the card (title case style phrases). */
export function weatherShortLabel(code: number): string {
  const raw = weatherDescription(code)
  if (raw === 'Clear sky') return 'Sunny'
  if (raw === 'Mostly clear') return 'Mostly sunny'
  if (raw === 'Partly cloudy') return 'Partly cloudy'
  if (raw === 'Overcast') return 'Cloudy'
  return raw
}

/** Emoji from wind + WMO weather code (wind overrides when strong). */
export function weatherEmoji(windMph: number, code: number): string {
  if (windMph >= 22) return '💨'
  if (code === 0 || code === 1) return '☀️'
  if (code === 2 || code === 3 || code === 45 || code === 48) return '⛅'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99)) return '🌧️'
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return '❄️'
  return '⛅'
}

export async function fetchCourtWeatherCached(
  courtId: string,
  latitude: number,
  longitude: number
): Promise<CachedCourtWeather> {
  const cached = cache.get(courtId)
  if (cached != null && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached
  }

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,weather_code,wind_speed_10m',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
  })

  const res = await fetch(`${OPEN_METEO_BASE}?${params.toString()}`)
  if (!res.ok) {
    throw new Error(`Weather request failed (${res.status})`)
  }

  const json: unknown = await res.json()
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid weather response')
  }

  const cur = (json as { current?: Record<string, unknown> }).current
  if (!cur || typeof cur !== 'object') {
    throw new Error('Missing current weather')
  }

  const temperatureF = Number(cur.temperature_2m)
  const weatherCode = Number(cur.weather_code)
  const windMph = Number(cur.wind_speed_10m)

  if (!Number.isFinite(temperatureF) || !Number.isFinite(weatherCode)) {
    throw new Error('Incomplete weather data')
  }

  const data: CachedCourtWeather = {
    fetchedAt: Date.now(),
    temperatureF,
    weatherCode,
    windMph: Number.isFinite(windMph) ? windMph : 0,
  }

  cache.set(courtId, data)
  return data
}
