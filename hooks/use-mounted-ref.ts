import { useEffect, useRef, type MutableRefObject } from 'react'

/** Returns a ref that is true while mounted — use in async work before setState. */
export function useMountedRef(): MutableRefObject<boolean> {
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  return mounted
}
