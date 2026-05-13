import { Linking, Platform } from 'react-native'

/** Opens the OS app settings (location, notifications, photos, etc.). */
export function openAppSettings(): void {
  Linking.openSettings().catch(() => {})
}

/**
 * iOS deep link to the app’s Settings page (works for enabling Location / Notifications).
 * Falls back to `openAppSettings` if the URL cannot be opened.
 */
export function openIOSAppSettingsDeepLink(): void {
  if (Platform.OS === 'ios') {
    Linking.openURL('app-settings:').catch(() => {
      Linking.openSettings().catch(() => {})
    })
  } else {
    openAppSettings()
  }
}
