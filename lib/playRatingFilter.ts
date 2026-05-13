type Listener = () => void

let ratingMin = 1.0
let ratingMax = 5.0
const listeners = new Set<Listener>()

export function getPlayRatingFilter() {
  return { ratingMin, ratingMax }
}

export function setPlayRatingFilter(next: { ratingMin: number; ratingMax: number }) {
  ratingMin = next.ratingMin
  ratingMax = next.ratingMax
  listeners.forEach((l) => l())
}

export function subscribePlayRatingFilter(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
