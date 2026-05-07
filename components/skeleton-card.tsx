import { Platform, StyleSheet, View } from 'react-native'

import { SkeletonBox } from '@/components/skeleton-box'

/** Generic row: avatar circle + title + subtitle + trailing badge (friends, search rows). */
export function SkeletonCard({ isDark }: { isDark?: boolean }) {
  const cardBg = isDark ? '#1C1C1E' : '#FFFFFF'
  const border = isDark ? '#3F3F46' : '#E2E8F0'
  return (
    <View
      style={[
        styles.friendCard,
        {
          backgroundColor: cardBg,
          borderColor: border,
        },
        !isDark && Platform.OS !== 'web' ? styles.friendCardShadow : null,
      ]}>
      <SkeletonBox width={44} height={44} borderRadius={22} />
      <View style={styles.midCol}>
        <SkeletonBox height={17} borderRadius={6} width="72%" />
        <SkeletonBox height={13} borderRadius={5} width="48%" style={{ marginTop: 8 }} />
      </View>
      <SkeletonBox width={56} height={28} borderRadius={999} />
    </View>
  )
}

/** Map bottom sheet court row shape (title + meta + availability pill). */
export function SkeletonCourtSheetRow({ isDark }: { isDark?: boolean }) {
  const cardBg = isDark ? '#1C1C1E' : '#FFFFFF'
  const border = isDark ? '#3F3F46' : '#E2E8F0'
  return (
    <View
      style={[
        styles.courtSheetCard,
        {
          backgroundColor: cardBg,
          borderColor: border,
        },
        !isDark && Platform.OS !== 'web' ? styles.friendCardShadow : null,
      ]}>
      <View style={styles.courtBody}>
        <SkeletonBox height={17} borderRadius={6} width="88%" />
        <SkeletonBox height={14} borderRadius={5} width="92%" style={{ marginTop: 8 }} />
      </View>
      <SkeletonBox width={56} height={34} borderRadius={999} />
    </View>
  )
}

/** Play tab game post card (avatar row + message strip + footer). */
export function SkeletonGamePostCard({ isDark }: { isDark?: boolean }) {
  const cardBg = isDark ? '#161618' : '#FFFFFF'
  const border = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15, 23, 42, 0.06)'
  return (
    <View style={[styles.gameCard, { backgroundColor: cardBg, borderColor: border }]}>
      <View style={styles.gameTop}>
        <SkeletonBox width={40} height={40} borderRadius={20} />
        <View style={styles.gameInfo}>
          <SkeletonBox height={15} borderRadius={6} width="55%" />
          <SkeletonBox height={12} borderRadius={5} width="40%" style={{ marginTop: 8 }} />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <SkeletonBox height={22} borderRadius={999} width={72} />
            <SkeletonBox height={22} borderRadius={999} width={56} />
          </View>
        </View>
        <SkeletonBox width={88} height={26} borderRadius={999} />
      </View>
      <SkeletonBox height={14} borderRadius={6} width="100%" style={{ marginTop: 14 }} />
      <SkeletonBox height={14} borderRadius={6} width="76%" style={{ marginTop: 8 }} />
      <SkeletonBox height={40} borderRadius={12} width="100%" style={{ marginTop: 14 }} />
      <SkeletonBox height={42} borderRadius={12} width="100%" style={{ marginTop: 10 }} />
    </View>
  )
}

/** Record tab match history card. */
export function SkeletonMatchCard({ isDark }: { isDark?: boolean }) {
  const cardBg = isDark ? '#161618' : '#FFFFFF'
  const border = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15, 23, 42, 0.06)'
  return (
    <View style={[styles.matchCard, { backgroundColor: cardBg, borderColor: border }]}>
      <View style={styles.matchTop}>
        <SkeletonBox width={40} height={40} borderRadius={20} />
        <View style={styles.midCol}>
          <SkeletonBox height={15} borderRadius={6} width="62%" />
          <SkeletonBox height={12} borderRadius={5} width="38%" style={{ marginTop: 8 }} />
        </View>
        <View style={{ alignItems: 'flex-end', gap: 8 }}>
          <SkeletonBox height={14} borderRadius={5} width={56} />
          <SkeletonBox height={26} borderRadius={999} width={72} />
        </View>
      </View>
    </View>
  )
}

/** My Sessions stacked lines inside session card chrome. */
export function SkeletonSessionCard({ isDark }: { isDark?: boolean }) {
  const cardBg = isDark ? '#161618' : '#FFFFFF'
  const border = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15, 23, 42, 0.06)'
  return (
    <View style={[styles.sessionCard, { backgroundColor: cardBg, borderColor: border }]}>
      <SkeletonBox height={17} borderRadius={6} width="85%" />
      <SkeletonBox height={14} borderRadius={5} width="55%" style={{ marginTop: 10 }} />
      <SkeletonBox height={13} borderRadius={5} width="40%" style={{ marginTop: 8 }} />
      <SkeletonBox height={40} borderRadius={8} width="100%" style={{ marginTop: 12 }} />
    </View>
  )
}

/** Settings profile header area. */
export function SkeletonSettingsProfile({ isDark }: { isDark?: boolean }) {
  return (
    <View style={styles.profileSkeleton}>
      <SkeletonBox width={90} height={90} borderRadius={45} />
      <SkeletonBox height={22} borderRadius={8} width={160} style={{ marginTop: 16 }} />
      <SkeletonBox height={14} borderRadius={6} width={112} style={{ marginTop: 10 }} />
      <View style={[styles.statsRowSkel, { borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)' }]}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.statBlockSkel}>
            <SkeletonBox height={22} borderRadius={6} width={36} />
            <SkeletonBox height={11} borderRadius={4} width={44} style={{ marginTop: 8 }} />
          </View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  friendCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  friendCardShadow: {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  courtSheetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 12,
  },
  courtBody: {
    flex: 1,
    minWidth: 0,
  },
  midCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  gameCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 12,
  },
  gameTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  gameInfo: {
    flex: 1,
    minWidth: 0,
  },
  matchCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 10,
  },
  matchTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sessionCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 12,
  },
  profileSkeleton: {
    alignItems: 'center',
    alignSelf: 'stretch',
    paddingBottom: 8,
  },
  statsRowSkel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 28,
  },
  statBlockSkel: {
    alignItems: 'center',
  },
})
