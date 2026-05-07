import NetInfo from '@react-native-community/netinfo'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

type NetworkStatusValue = {
  /** True when we treat the device as having no usable connection */
  isOffline: boolean
}

const NetworkStatusContext = createContext<NetworkStatusValue | null>(null)

export function NetworkStatusProvider({ children }: { children: ReactNode }) {
  const [isOffline, setIsOffline] = useState(false)

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      const disconnected = state.isConnected === false
      const unreachable = state.isInternetReachable === false
      setIsOffline(disconnected || unreachable)
    })
    return () => unsub()
  }, [])

  const value = useMemo(() => ({ isOffline }), [isOffline])

  return <NetworkStatusContext.Provider value={value}>{children}</NetworkStatusContext.Provider>
}

export function useNetworkOffline(): boolean {
  const ctx = useContext(NetworkStatusContext)
  return ctx?.isOffline ?? false
}
