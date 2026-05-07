import { Alert } from 'react-native'

import { userFriendlyFromUnknown } from '@/lib/errors'
import { openAppSettings } from '@/lib/open-settings'

type AlertButton = { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }

export function showFriendlyAlert(title: string, err: unknown, extraButtons?: AlertButton[]) {
  const message = userFriendlyFromUnknown(err)
  const buttons: AlertButton[] = [...(extraButtons ?? []), { text: 'OK', style: 'cancel' }]
  Alert.alert(title, message, buttons.length > 1 ? buttons : undefined)
}

/** When an action needs system settings (notifications, location). */
export function alertOpenSettings(
  title: string,
  body: string,
  settingsLabel = 'Open Settings',
): void {
  Alert.alert(title, body, [
    { text: 'Not now', style: 'cancel' },
    { text: settingsLabel, onPress: () => openAppSettings() },
  ])
}
