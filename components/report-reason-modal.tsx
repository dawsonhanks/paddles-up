import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { REPORT_REASONS, submitContentReport, type ContentReportType } from '@/lib/contentReports'
import { userFriendlyFromUnknown } from '@/lib/errors'
import { MaterialIcons } from '@expo/vector-icons'
import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'

const THANKS = "Thanks for your report — we'll review it shortly."

type ReportReasonModalProps = {
  visible: boolean
  onClose: () => void
  contentType: ContentReportType
  contentId: string
}

export function ReportReasonModal({ visible, onClose, contentType, contentId }: ReportReasonModalProps) {
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']
  const isDark = colorScheme === 'dark'
  const cardBg = isDark ? '#1C1C1E' : '#FFFFFF'
  const border = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.12)'

  const [selected, setSelected] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const reset = useCallback(() => {
    setSelected(null)
    setSubmitting(false)
  }, [])

  const handleClose = useCallback(() => {
    reset()
    onClose()
  }, [onClose, reset])

  const submit = useCallback(async () => {
    if (!selected || submitting) return
    setSubmitting(true)
    try {
      const { error } = await submitContentReport({
        contentType,
        contentId,
        reason: selected,
      })
      if (error) {
        Alert.alert('Report did not send', userFriendlyFromUnknown(error.message))
        return
      }
      handleClose()
      Alert.alert('Thank you', THANKS)
    } finally {
      setSubmitting(false)
    }
  }, [contentId, contentType, handleClose, selected, submitting])

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable style={[styles.sheet, { backgroundColor: cardBg, borderColor: border }]} onPress={(e) => e.stopPropagation()}>
          <Text style={[styles.title, { color: theme.text }]}>Report</Text>
          <Text style={[styles.sub, { color: theme.icon }]}>Why are you reporting this?</Text>
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {REPORT_REASONS.map((reason) => {
              const active = selected === reason
              return (
                <Pressable
                  key={reason}
                  onPress={() => setSelected(reason)}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      borderColor: active ? '#1D9E75' : border,
                      backgroundColor: active ? (isDark ? 'rgba(29,158,117,0.2)' : '#E1F5EE') : 'transparent',
                      opacity: pressed ? 0.88 : 1,
                    },
                  ]}>
                  <Text style={[styles.optionText, { color: theme.text }]}>{reason}</Text>
                  {active ? <MaterialIcons name="check-circle" size={22} color="#1D9E75" /> : null}
                </Pressable>
              )
            })}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable
              onPress={handleClose}
              style={({ pressed }) => [styles.btnGhost, { borderColor: border, opacity: pressed ? 0.85 : 1 }]}>
              <Text style={[styles.btnGhostText, { color: theme.text }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => void submit()}
              disabled={!selected || submitting}
              style={({ pressed }) => [
                styles.btnPrimary,
                { opacity: !selected || submitting ? 0.5 : pressed ? 0.9 : 1 },
              ]}>
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnPrimaryText}>Submit</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  sheet: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    maxHeight: '80%',
  },
  title: { fontSize: 20, fontWeight: '800', marginBottom: 6 },
  sub: { fontSize: 14, marginBottom: 14 },
  list: { maxHeight: 320 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  optionText: { fontSize: 16, fontWeight: '600', flex: 1, marginRight: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  btnGhost: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  btnGhostText: { fontSize: 16, fontWeight: '700' },
  btnPrimary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#1D9E75',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
})
