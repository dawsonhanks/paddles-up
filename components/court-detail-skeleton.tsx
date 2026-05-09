import { ScrollView, StyleSheet, View } from 'react-native'

import { SkeletonBox } from '@/components/skeleton-box'

type CourtDetailSkeletonProps = {
  screenBg: string
  cardBorder: string
}

/** Loading placeholders aligned with unified court detail flow (no outer cards). */
export function CourtDetailSkeleton({ screenBg, cardBorder }: CourtDetailSkeletonProps) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: screenBg }}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}>
      <SkeletonBox height={32} borderRadius={8} width="94%" style={{ marginBottom: 14 }} />
      <SkeletonBox height={30} borderRadius={999} width={96} style={{ marginBottom: 14 }} />
      <View style={styles.metaSkel}>
        <SkeletonBox height={14} borderRadius={6} width={88} />
        <SkeletonBox height={14} borderRadius={6} width={10} />
        <SkeletonBox height={14} borderRadius={6} width={72} />
        <SkeletonBox height={14} borderRadius={6} width={10} />
        <SkeletonBox height={14} borderRadius={6} width={76} />
      </View>
      <SkeletonBox height={44} borderRadius={16} width="100%" style={{ marginBottom: 32 }} />

      <SkeletonBox height={40} borderRadius={10} width="78%" style={{ alignSelf: 'center', marginBottom: 16 }} />
      <View style={styles.pillsSkel}>
        {[56, 56, 56, 56, 56, 56, 56].map((w, i) => (
          <SkeletonBox key={i} width={w} height={36} borderRadius={999} />
        ))}
      </View>

      <SkeletonBox height={20} borderRadius={6} width="52%" style={{ marginTop: 28, marginBottom: 10 }} />
      <SkeletonBox height={15} borderRadius={6} width="40%" style={{ marginBottom: 14 }} />
      <SkeletonBox height={54} borderRadius={16} width="100%" style={{ marginBottom: 28 }} />

      <View style={[styles.zoneSkelRow, { borderBottomColor: cardBorder }]}>
        <SkeletonBox height={17} borderRadius={6} width="42%" />
        <SkeletonBox height={32} borderRadius={999} width={132} />
      </View>
      <View style={[styles.zoneSkelRow, { borderBottomWidth: 0 }]}>
        <SkeletonBox height={17} borderRadius={6} width="48%" />
        <SkeletonBox height={32} borderRadius={999} width={132} />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 40,
  },
  metaSkel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 24,
  },
  pillsSkel: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  zoneSkelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
})
