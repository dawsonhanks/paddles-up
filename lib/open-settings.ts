import { Linking } from 'react-native'

/** Opens the OS app settings (location, notifications, photos, etc.). */
export function openAppSettings(): void {
  Linking.openSettings().catch(() => {})
}
