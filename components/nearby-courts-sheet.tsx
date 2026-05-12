import { ContentFadeIn } from '@/components/content-fade-in'
import { SkeletonCourtSheetRow } from '@/components/skeleton-card'
import { courtsAvailableToPinStatus } from '@/lib/availability'
import { STATUS_PIN_COLOR, type Court } from '@/lib/courts'
import { formatDistanceMiles } from '@/lib/geo'
import { MaterialIcons } from '@expo/vector-icons'
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet'
import type { ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'
import {
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
/** Collapsed sheet: handle + title + hint only (no list rows). */
const COLLAPSED_SHEET_BASE_PX = 108

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

function CollapsedPeek({
  isDark,
  listLoading,
  expandHint,
}: {
  isDark: boolean
  listLoading: boolean
  expandHint: string
}) {
  return (
    <View style={styles.collapsedPeek}>
      <Text style={[styles.sheetTitle, { color: isDark ? '#F8FAFC' : '#0F172A', marginBottom: 4 }]}>Nearby courts</Text>
      <Text style={[styles.collapsedHint, { color: isDark ? '#A1A1AA' : '#64748B' }]}>
        {listLoading ? 'Loading…' : expandHint}
      </Text>
    </View>
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
  /** Shows placeholder rows shaped like court cards while the list is loading. */
  listLoading?: boolean
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
    listLoading = false,
  } = props
  const insets = useSafeAreaInsets()
  const [sheetIndex, setSheetIndex] = useState(0)
  const [webExpanded, setWebExpanded] = useState(false)
  const collapsedPeekPx = useMemo(
    () => Math.round(COLLAPSED_SHEET_BASE_PX + insets.bottom),
    [insets.bottom],
  )
  const snapPoints = useMemo(() => [collapsedPeekPx, '66%', '90%'], [collapsedPeekPx])
  const sheetOpen = sheetIndex > 0

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
    () =>
      sheetOpen ? (
        <FilterPills filter={filter} onChange={onFilterChange} isDark={isDark} />
      ) : (
        <CollapsedPeek isDark={isDark} listLoading={listLoading} expandHint="Pull up for the list and filters" />
      ),
    [filter, onFilterChange, isDark, sheetOpen, listLoading],
  )

  const EmptyList = useCallback(() => {
    if (showNoFavoritesYetHint) {
      return (
        <Text style={[styles.emptyText, styles.emptyHintCenter, { color: isDark ? '#A1A1AA' : '#64748B' }]}>
          No favorites yet — tap the heart on any court to save it here
        </Text>
      )
    }
    return (
      <Text style={[styles.emptyText, { color: isDark ? '#71717A' : '#94A3B8' }]}>No courts match this filter.</Text>
    )
  }, [isDark, showNoFavoritesYetHint])

  if (Platform.OS === 'web') {
    const webCollapsedH = Math.round(COLLAPSED_SHEET_BASE_PX + insets.bottom)
    return (
      <View
        style={[
          styles.webSheet,
          {
            maxHeight: webExpanded ? WEB_SHEET_MAX : webCollapsedH,
            paddingBottom: webExpanded ? insets.bottom + 8 : insets.bottom + 4,
            backgroundColor: isDark ? '#18181B' : '#FFFFFF',
            borderColor: isDark ? '#3F3F46' : '#E2E8F0',
          },
        ]}>
        {webExpanded ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Collapse nearby courts panel"
            onPress={() => setWebExpanded(false)}
            style={({ pressed }) => [styles.webPeekHit, { opacity: pressed ? 0.85 : 1 }]}>
            <View style={[styles.handle, { backgroundColor: isDark ? '#52525B' : '#CBD5E1' }]} />
            <View style={styles.webExpandedPeekRow}>
              <Text style={[styles.sheetTitle, { color: isDark ? '#F8FAFC' : '#0F172A', marginBottom: 0, flex: 1 }]}>
                Nearby courts
              </Text>
              <MaterialIcons name="expand-more" size={22} color={isDark ? '#A1A1AA' : '#64748B'} />
            </View>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Expand nearby courts panel"
            onPress={() => setWebExpanded(true)}
            style={({ pressed }) => [styles.webPeekHit, { opacity: pressed ? 0.85 : 1 }]}>
            <View style={[styles.handle, { backgroundColor: isDark ? '#52525B' : '#CBD5E1' }]} />
        <CollapsedPeek isDark={isDark} listLoading={listLoading} expandHint="Tap for the list and filters" />
          </Pressable>
        )}
        {webExpanded ? (
          <>
            <FilterPills filter={filter} onChange={onFilterChange} isDark={isDark} />
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
          </>
        ) : null}
      </View>
    )
  }

  type SheetRow = CourtWithDistance | (typeof SHEET_SKELETON_KEYS)[number]

  const sheetListData: readonly SheetRow[] = sheetOpen
    ? listLoading
      ? [...SHEET_SKELETON_KEYS]
      : courts
    : []

  const sheetKeyExtractor = useCallback((item: SheetRow) => (typeof item === 'string' ? item : item.id), [])

  const renderSheetRow = useCallback(
    ({ item }: { item: SheetRow }) =>
      typeof item === 'string' ? <SkeletonCourtSheetRow isDark={isDark} /> : renderCourtItem({ item }),
    [isDark, renderCourtItem],
  )

  return (
    <BottomSheet
      index={0}
      snapPoints={snapPoints}
      onChange={setSheetIndex}
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
      <BottomSheetFlatList
          data={sheetListData}
          extraData={`${filter}:${sheetIndex}:${listLoading}`}
          keyExtractor={sheetKeyExtractor}
          renderItem={renderSheetRow}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={sheetOpen && !listLoading ? EmptyList : null}
          contentContainerStyle={[styles.listPad, { paddingBottom: 16 }]}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          scrollEnabled={sheetOpen}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onScrollBeginDrag={() => Keyboard.dismiss()}
          onRefresh={sheetOpen ? onRefresh : undefined}
          refreshing={sheetOpen ? refreshing : false}
          tintColor="#1D9E75"
          colors={['#1D9E75']}
        />
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
  collapsedPeek: {
    paddingHorizontal: 4,
    paddingBottom: 10,
  },
  collapsedHint: {
    fontSize: 14,
    lineHeight: 19,
    paddingHorizontal: 16,
  },
  webPeekHit: {
    width: '100%',
  },
  webExpandedPeekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
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
})
