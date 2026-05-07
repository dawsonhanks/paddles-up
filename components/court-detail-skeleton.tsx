import { Platform, ScrollView, StyleSheet, View } from 'react-native'

import { SkeletonBox } from '@/components/skeleton-box'

const cardShadow =
  Platform.OS === 'ios'
    ? { shadowColor: '#0f172a', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.07, shadowRadius: 20 }
    : { elevation: 6 }

type CourtDetailSkeletonProps = {
  screenBg: string
  cardBg: string
  cardBorder: string
}

/** Mirrors hero card + Live activity header + crowd card + check-in row spacing on court detail. */
export function CourtDetailSkeleton({ screenBg, cardBg, cardBorder }: CourtDetailSkeletonProps) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: screenBg }}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}>
      <View style={[styles.heroCard, { backgroundColor: cardBg, borderColor: cardBorder }, cardShadow]}>
        <SkeletonBox height={28} borderRadius={8} width="92%" />
        <View style={styles.heroMetaSkel}>
          <SkeletonBox height={22} borderRadius={999} width={68} />
          <SkeletonBox height={12} borderRadius={4} width={10} />
          <SkeletonBox height={13} borderRadius={6} width={96} />
          <SkeletonBox height={12} borderRadius={4} width={10} />
          <SkeletonBox height={14} borderRadius={6} width={88} />
        </View>
        <View style={[styles.heroDivider, { backgroundColor: cardBorder }]} />
        <View style={styles.heroActionsSkel}>
          <SkeletonBox height={30} borderRadius={999} width={92} />
          <SkeletonBox height={34} borderRadius={999} width={118} />
        </View>
      </View>

      <SkeletonBox height={18} borderRadius={6} width={132} style={{ marginBottom: 6 }} />
      <SkeletonBox height={14} borderRadius={6} width="94%" style={{ marginBottom: 14 }} />

      <View style={[styles.playersCard, { backgroundColor: cardBg, borderColor: cardBorder }, cardShadow]}>
        <SkeletonBox height={28} borderRadius={8} width="72%" style={{ alignSelf: 'center' }} />
        <SkeletonBox height={17} borderRadius={6} width="85%" style={{ alignSelf: 'center', marginTop: 12 }} />
        <SkeletonBox height={12} borderRadius={6} width="78%" style={{ alignSelf: 'center', marginTop: 14 }} />
      </View>

      <View style={[styles.checkinSkel, { backgroundColor: cardBg, borderColor: cardBorder }, cardShadow]}>
        <SkeletonBox width={48} height={48} borderRadius={24} />
        <View style={{ flex: 1, gap: 10 }}>
          <SkeletonBox height={15} borderRadius={6} width="52%" />
          <SkeletonBox height={13} borderRadius={6} width="92%" />
        </View>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 32,
  },
  heroCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  heroMetaSkel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  heroDivider: {
    alignSelf: 'stretch',
    height: StyleSheet.hairlineWidth,
    marginTop: 10,
    marginBottom: 10,
  },
  heroActionsSkel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  playersCard: {
    borderRadius: 18,
    borderWidth: 2,
    paddingVertical: 22,
    paddingHorizontal: 18,
    marginBottom: 12,
    alignItems: 'stretch',
  },
  checkinSkel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 10,
  },
})
