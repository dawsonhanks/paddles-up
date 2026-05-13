import { ActionSheetIOS, Alert, Platform } from 'react-native'

/**
 * Long-press follow-up: small sheet with Report / Cancel (per App Store UGC patterns).
 */
export function showReportActionSheet(onReport: () => void): void {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['Cancel', 'Report'],
        cancelButtonIndex: 0,
        destructiveButtonIndex: 1,
      },
      (buttonIndex) => {
        if (buttonIndex === 1) onReport()
      },
    )
    return
  }

  Alert.alert('Content', undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Report', style: 'destructive', onPress: onReport },
  ])
}
