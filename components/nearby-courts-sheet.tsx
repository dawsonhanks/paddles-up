import { ContentFadeIn } from '@/components/content-fade-in'
import { SkeletonCourtSheetRow } from '@/components/skeleton-card'
import { courtsAvailableToPinStatus } from '@/lib/availability'
import { STATUS_PIN_COLOR, type Court } from '@/lib/courts'
import { formatDistanceMiles } from '@/lib/geo'
import { MaterialIcons } from '@expo/vector-icons'
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet'
import type { ReactNode } from 'react'
import { useCallback, useMemo } from 'react'
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export type ListFilter = 'all' | 'open' | 'outdoor' | 'indoor' | 'favorites'

export type CourtWithDistance = Court & { distanceKm: number }

const BRAND_GREEN = '#1D9E75'
/**
 * Map tab only: `CourtMap` bottom padding for the Apple/Google legal line.
 * Intentionally **not** tied to the bottom sheet's visual peek height.
 */
export const MAP_NEARBY_SHEET_COLLAPSED_BASE_PX = 108
/** Bottom sheet first snap: room for title + filter row + first court card. */
const COLLAPSED_SHEET_PEEK_PX = 210

export function matchesListFilter(court: Court, filter: ListFilter, favoriteIds?: ReadonlySet<string>): boolean {
  if (filter === 'favorites') return favoriteIds?.has(court.id) ?? false
  if (filter === 'all') return true
  if (filter === 'open') return court.status === 'open'
  const label = (court.indoorOutdoor ?? '').toLowerCase()
  if (filter === 'outdoor') return label.includes('outdoor')
  if (filter === 'indoor') return label.includes('indoor')
  return true
}

const FILTER_OPTIONS: { key: ListFilter; label: string; icon?: 'favorite' }[] = [
  { key: 'all', label: 'All' },
  { key: 'favorites', label: 'Favorites', icon: 'favorite' },
  { key: 'open', label: 'Open only' },
  { key: 'outdoor', label: 'Outdoor' },
  { key: 'indoor', label: 'Indoor' },
]

function CourtsOpenBadge({
  liveCourtsAvailable,
  courtCount,
  isDark,
}: {
  liveCourtsAvailable: number | null | undefined
  courtCount: number
  isDark: boolean
}) {
  const total = Math.max(1, courtCount)
  const raw =
    liveCourtsAvailable != null && Number.isFinite(liveCourtsAvailable)
      ? Math.floor(liveCourtsAvailable)
      : null
  if (raw === null) {
    return (
      <View style={[styles.badgeNoReport, { backgroundColor: isDark ? '#374151' : '#E5E7EB' }]}>
        <Text style={[styles.badgeNoReportText, { color: isDark ? '#9CA3AF' : '#6B7280' }]} numberOfLines={1}>
          No report
        </Text>
      </View>
    )
  }
  const clamped = Math.min(Math.max(0, raw), total)
  const st = courtsAvailableToPinStatus(clamped, total)
  const bg = STATUS_PIN_COLOR[st]
  return (
    <View style={[styles.badgePill, styles.badgePillShrink, { backgroundColor: bg }]}>
      <Text style={styles.badgePillText} numberOfLines={1}>{`${clamped} of ${total} open`}</Text>
    </View>
  )
}

function FilterPills({
  filter,
  onChange,
  isDark,
}: {
  filter: ListFilter
  onChange: (f: ListFilter) => void
  isDark: boolean
}) {
  return (
    <View style={styles.filterWrap}>
      <Text style={[styles.sheetTitle, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>Nearby courts</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterScroll}>
        {FILTER_OPTIONS.map((opt) => {
          const active = filter === opt.key
          return (
            <Pressable
              key={opt.key}
              onPress={() =>
                filter === opt.key && opt.key === 'favorites' ? onChange('all') : onChange(opt.key)
              }
              style={({ pressed }) => [
                styles.filterPill,
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: opt.icon ? 6 : 0,
                  backgroundColor: active ? BRAND_GREEN : isDark ? '#27272A' : '#F1F5F9',
                  borderColor: active ? BRAND_GREEN : isDark ? '#3F3F46' : '#E2E8F0',
                  opacity: pressed ? 0.85 : 1,
                },
              ]}>
              {opt.icon === 'favorite' ? (
                <MaterialIcons name={opt.icon} size={17} color={active ? '#FFFFFF' : BRAND_GREEN} />
              ) : null}
              <Text
                style={[styles.filterPillText, { color: active ? '#FFFFFF' : isDark ? '#A1A1AA' : '#475569' }]}>
                {opt.label}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

function CourtRow({
  item,
  onPress,
  selected,
  isDark,
}: {
  item: CourtWithDistance
  onPress: () => void
  selected: boolean
  isDark: boolean
}) {
  const venue = item.indoorOutdoor?.trim() || '—'
  const courtsLabel = `${item.courtCount} court${item.courtCount === 1 ? '' : 's'}`
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.courtCard,
        {
          backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF',
          borderColor: selected ? '#0EA5E9' : isDark ? '#3F3F46' : '#E2E8F0',
          borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
          opacity: pressed ? 0.92 : 1,
        },
        !isDark && Platform.OS !== 'web' ? styles.courtCardShadow : null,
      ]}>
      <View style={styles.courtCardBody}>
        <Text style={[styles.courtName, { color: isDark ? '#F8FAFC' : '#0F172A' }]} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={[styles.courtMeta, { color: isDark ? '#A1A1AA' : '#64748B' }]}>
          {formatDistanceMiles(item.distanceKm)} · {courtsLabel} · {venue}
        </Text>
      </View>
      <CourtsOpenBadge liveCourtsAvailable={item.liveCourtsAvailable} courtCount={item.courtCount} isDark={isDark} />
    </Pressable>
  )
}

const SHEET_SKELETON_KEYS = ['sk1', 'sk2', 'sk3', 'sk4'] as const

type NearbyCourtsSheetProps = {
  courts: CourtWithDistance[]
  filter: ListFilter
  onFilterChange: (f: ListFilter) => void
  onCourtPress: (id: string) => void
  selectedId: string | null
  isDark: boolean
  refreshing?: boolean
  onRefresh?: () => void
  showNoFavoritesYetHint?: boolean
  showNoCourtsWithin5MilesHint?: boolean
  /** Shows placeholder rows shaped like court cards while the list is loading. */
  listLoading?: boolean
  /** Subtle in-list status while refreshing courts for the visible map area. */
  listFindingCourts?: boolean
}

const WEB_SHEET_MAX = Math.round(Dimensions.get('window').height * 0.52)

export function NearbyCourtsSheet(props: NearbyCourtsSheetProps) {
  const {
    courts,
    filter,
    onFilterChange,
    onCourtPress,
    selectedId,
    isDark,
    refreshing = false,
    onRefresh,
    showNoFavoritesYetHint,
    showNoCourtsWithin5MilesHint,
    listLoading = false,
    listFindingCourts = false,
  } = props
  const insets = useSafeAreaInsets()
  const collapsedPeekPx = useMemo(
    () => Math.round(COLLAPSED_SHEET_PEEK_PX + insets.bottom),
    [insets.bottom],
  )
  const snapPoints = useMemo(() => [collapsedPeekPx, '66%', '90%'], [collapsedPeekPx])

  const renderCourtItem = useCallback(
    ({ item }: { item: CourtWithDistance }) => (
      <CourtRow
        item={item}
        selected={item.id === selectedId}
        isDark={isDark}
        onPress={() => onCourtPress(item.id)}
      />
    ),
    [isDark, onCourtPress, selectedId],
  )

  const renderSkeletonSheetItem = useCallback(() => <SkeletonCourtSheetRow isDark={isDark} />, [isDark])

  const ListHeader = useCallback(
    () => (
      <View>
        <FilterPills filter={filter} onChange={onFilterChange} isDark={isDark} />
        {listFindingCourts ? (
          <View style={styles.findingCourtsRow}>
            <ActivityIndicator size="small" color={BRAND_GREEN} />
            <Text style={[styles.findingCourtsText, { color: isDark ? '#94A3B8' : '#64748B' }]}>
              Finding courts…
            </Text>
          </View>
        ) : null}
      </View>
    ),
    [filter, onFilterChange, isDark, listFindingCourts],
  )

  const EmptyList = useCallback(() => {
    if (showNoFavoritesYetHint) {
      return (
        <Text style={[styles.emptyText, styles.emptyHintCenter, { color: isDark ? '#A1A1AA' : '#64748B' }]}>
          No favorites yet — tap the heart on any court to save it here
        </Text>
      )
    }
    if (showNoCourtsWithin5MilesHint) {
      return (
        <Text style={[styles.emptyText, styles.emptyHintCenter, { color: isDark ? '#A1A1AA' : '#64748B' }]}>
          No courts within 5 miles — try exploring the map to find more
        </Text>
      )
    }
    return (
      <Text style={[styles.emptyText, { color: isDark ? '#71717A' : '#94A3B8' }]}>No courts match this filter.</Text>
    )
  }, [isDark, showNoCourtsWithin5MilesHint, showNoFavoritesYetHint])

  if (Platform.OS === 'web') {
    return (
      <View
        style={[
          styles.webSheet,
          {
            maxHeight: WEB_SHEET_MAX,
            paddingBottom: insets.bottom + 8,
            backgroundColor: isDark ? '#18181B' : '#FFFFFF',
            borderColor: isDark ? '#3F3F46' : '#E2E8F0',
          },
        ]}>
        <View style={[styles.handle, { backgroundColor: isDark ? '#52525B' : '#CBD5E1' }]} />
        <FilterPills filter={filter} onChange={onFilterChange} isDark={isDark} />
        {listFindingCourts ? (
          <View style={styles.findingCourtsRow}>
            <ActivityIndicator size="small" color={BRAND_GREEN} />
            <Text style={[styles.findingCourtsText, { color: isDark ? '#94A3B8' : '#64748B' }]}>
              Finding courts…
            </Text>
          </View>
        ) : null}
        {listLoading ? (
          <FlatList
            data={[...SHEET_SKELETON_KEYS]}
            keyExtractor={(item) => item}
            renderItem={renderSkeletonSheetItem}
            contentContainerStyle={styles.listPad}
            style={{ flex: 1 }}
            nestedScrollEnabled
          />
        ) : (
          <ContentFadeIn show style={{ flex: 1 }}>
            <FlatList
              data={courts}
              extraData={filter}
              keyExtractor={(item) => item.id}
              renderItem={renderCourtItem}
              ListEmptyComponent={EmptyList}
              contentContainerStyle={styles.listPad}
              style={{ flex: 1 }}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              onScrollBeginDrag={() => Keyboard.dismiss()}
              onRefresh={onRefresh}
              refreshing={refreshing}
              tintColor="#1D9E75"
              colors={['#1D9E75']}
            />
          </ContentFadeIn>
        )}
      </View>
    )
  }

  return (
    <BottomSheet
      index={0}
      snapPoints={snapPoints}
      enablePanDownToClose={false}
      // Let the sheet sit flush against the tab bar (avoid a visible gap).
      bottomInset={0}
      backgroundStyle={{
        backgroundColor: isDark ? '#18181B' : '#FFFFFF',
      }}
      handleIndicatorStyle={{
        backgroundColor: isDark ? '#52525B' : '#CBD5E1',
        width: 40,
      }}
      style={styles.sheetRoot}>
      {listLoading ? (
        <BottomSheetFlatList
          data={[...SHEET_SKELETON_KEYS]}
          keyExtractor={(item) => item}
          renderItem={renderSkeletonSheetItem}
          ListHeaderComponent={ListHeader}
          contentContainerStyle={[styles.listPad, { paddingBottom: 16 }]}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      ) : (
        <ContentFadeIn show style={{ flex: 1 }}>
          <BottomSheetFlatList
            data={courts}
            extraData={filter}
            keyExtractor={(item) => item.id}
            renderItem={renderCourtItem}
            ListHeaderComponent={ListHeader}
            ListEmptyComponent={EmptyList}
            contentContainerStyle={[styles.listPad, { paddingBottom: 16 }]}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onScrollBeginDrag={() => Keyboard.dismiss()}
            onRefresh={onRefresh}
            refreshing={refreshing}
            tintColor="#1D9E75"
            colors={['#1D9E75']}
          />
        </ContentFadeIn>
      )}
    </BottomSheet>
  )
}

/** Wrap map tab when using the native bottom sheet (required by @gorhom/bottom-sheet). */
export function MapTabGestureRoot({ children }: { children: ReactNode }) {
  return <GestureHandlerRootView style={styles.gestureRoot}>{children}</GestureHandlerRootView>
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
  sheetRoot: {
    flex: 1,
  },
  webSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: 8,
    marginBottom: 4,
  },
  filterWrap: {
    paddingBottom: 8,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  filterScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  filterPillText: {
    fontSize: 14,
    fontWeight: '600',
  },
  listPad: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  courtCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 12,
  },
  courtCardShadow: {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  courtCardBody: {
    flex: 1,
    minWidth: 0,
  },
  courtName: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 21,
  },
  courtMeta: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
  },
  badgePill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    minWidth: 64,
    alignItems: 'center',
  },
  badgePillShrink: {
    minWidth: 0,
    maxWidth: 118,
    paddingHorizontal: 10,
  },
  badgePillText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.25,
  },
  badgeNoReport: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 118,
  },
  badgeNoReportText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: 28,
    fontSize: 15,
  },
  emptyHintCenter: {
    paddingHorizontal: 24,
    lineHeight: 22,
  },
  findingCourtsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 4,
    paddingBottom: 10,
    paddingHorizontal: 16,
  },
  findingCourtsText: {
    fontSize: 13,
    fontWeight: '500',
  },
})
