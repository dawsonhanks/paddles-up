import { ContentFadeIn } from '@/components/content-fade-in'
import { SkeletonCourtSheetRow } from '@/components/skeleton-card'
import { STATUS_PIN_COLOR, type Court, type CourtStatus } from '@/lib/courts'
import { formatDistanceMiles } from '@/lib/geo'
import { venueSummaryBadgeLabel, venueSummaryToCourtStatus, type VenueZoneSummary } from '@/lib/zones'
import { MaterialIcons } from '@expo/vector-icons'
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet'
import type { ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Keyboard,
  Modal,
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
 * Tuned roughly to the collapsed sheet; not required to match peek px exactly.
 */
export const MAP_NEARBY_SHEET_COLLAPSED_BASE_PX = 60
/**
 * Collapsed peek height (plus safe-area bottom separately).
 * Budget: handle padding+indicator (24) + list top pad (4) + title (~22) +
 * title marginBottom-as-breathing-room (10) = 60 — stops just as filter pills begin.
 */
const PEEK_CONTENT_PX = 60
/** Expanded snap — full header, filters, and scrollable list. */
const EXPANDED_SNAP = '55%'

export function matchesListFilter(court: Court, filter: ListFilter, favoriteIds?: ReadonlySet<string>): boolean {
  if (filter === 'favorites') return favoriteIds?.has(court.id) ?? false
  if (filter === 'all') return true
  if (filter === 'open') return court.status === 'open'
  const label = (court.indoorOutdoor ?? '').toLowerCase()
  if (filter === 'outdoor') return label.includes('outdoor')
  if (filter === 'indoor') return label.includes('indoor')
  return true
}

/**
 * City filter — when a specific city is selected, only courts with that city match.
 * Null-city courts are visible only when no city filter is active (`city === null`).
 */
export function matchesCityFilter(court: Court, city: string | null): boolean {
  if (city == null) return true
  return court.city === city
}

/** List + city filters composed — shared by nearby sheet and map pins. */
export function matchesSheetFilters(
  court: Court,
  filter: ListFilter,
  city: string | null,
  favoriteIds?: ReadonlySet<string>,
): boolean {
  return matchesListFilter(court, filter, favoriteIds) && matchesCityFilter(court, city)
}

/** Distinct cities for the picker — null/unparseable cities excluded. Sorted A→Z. */
export function distinctCitiesFromCourts(courts: readonly Court[]): string[] {
  const set = new Set<string>()
  for (const c of courts) {
    if (c.city) set.add(c.city)
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

const FILTER_OPTIONS: { key: ListFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'favorites', label: 'Favorites' },
  { key: 'open', label: 'Open' },
  { key: 'outdoor', label: 'Outdoor' },
  { key: 'indoor', label: 'Indoor' },
]

function CourtsOpenBadge({
  liveCourtsAvailable,
  liveOpenTotal,
  liveBusyCount,
  liveUnknownCount,
  courtCount,
  status,
  isDark,
}: {
  liveCourtsAvailable: number | null | undefined
  liveOpenTotal: number | null | undefined
  liveBusyCount: number | null | undefined
  liveUnknownCount?: number | null | undefined
  courtCount: number
  status: CourtStatus
  isDark: boolean
}) {
  const hasZoneSummary =
    liveOpenTotal != null &&
    liveOpenTotal > 0 &&
    liveCourtsAvailable != null &&
    Number.isFinite(liveCourtsAvailable)

  // Zone-derived open/busy/unknown → badge color + label from the shared rollup.
  if (hasZoneSummary) {
    const total = Math.max(1, liveOpenTotal!)
    let busy = Math.max(0, Math.floor(liveBusyCount ?? 0))
    let unknown = Math.max(0, Math.floor(liveUnknownCount ?? 0))
    let open = Math.max(0, Math.floor(liveCourtsAvailable!))
    if (open + busy + unknown !== total) {
      // Prefer busy + unknown as reported; remainder is confirmed open.
      const remainder = Math.max(0, total - busy - unknown)
      open = remainder
      if (busy + unknown > total) {
        unknown = Math.max(0, total - busy)
      }
    }
    const summary: VenueZoneSummary = { open, busy, unknown, total }
    const st = venueSummaryToCourtStatus(summary)
    const label = venueSummaryBadgeLabel(summary)
    return (
      <View style={[styles.badgePill, styles.badgePillShrink, { backgroundColor: STATUS_PIN_COLOR[st] }]}>
        <Text style={styles.badgePillText} numberOfLines={1}>
          {label}
        </Text>
      </View>
    )
  }

  // Crowdsourced-only fallback (no zone rows): keep status + simple count/label.
  const raw =
    liveCourtsAvailable != null && Number.isFinite(liveCourtsAvailable)
      ? Math.floor(liveCourtsAvailable)
      : null
  if (raw !== null) {
    const total = Math.max(1, courtCount)
    const clamped = Math.min(Math.max(0, raw), total)
    return (
      <View style={[styles.badgePill, styles.badgePillShrink, { backgroundColor: STATUS_PIN_COLOR[status] }]}>
        <Text style={styles.badgePillText} numberOfLines={1}>{`${clamped} of ${total} open`}</Text>
      </View>
    )
  }

  if (status === 'open' || status === 'busy' || status === 'full') {
    const label = status === 'open' ? 'Open' : status === 'busy' ? 'Busy' : 'Full'
    return (
      <View style={[styles.badgePill, styles.badgePillShrink, { backgroundColor: STATUS_PIN_COLOR[status] }]}>
        <Text style={styles.badgePillText} numberOfLines={1}>
          {label}
        </Text>
      </View>
    )
  }

  return (
    <View style={[styles.badgeNoReport, { backgroundColor: isDark ? '#374151' : '#E5E7EB' }]}>
      <Text style={[styles.badgeNoReportText, { color: isDark ? '#9CA3AF' : '#6B7280' }]} numberOfLines={1}>
        No report
      </Text>
    </View>
  )
}

function FilterPillButton({
  label,
  active,
  isDark,
  onPress,
  trailing,
  maxWidth,
}: {
  label: string
  active: boolean
  isDark: boolean
  onPress: () => void
  trailing?: ReactNode
  maxWidth?: number
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterPill,
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: trailing ? 4 : 0,
          maxWidth,
          backgroundColor: active ? BRAND_GREEN : isDark ? '#27272A' : '#F1F5F9',
          borderColor: active ? BRAND_GREEN : isDark ? '#3F3F46' : '#E2E8F0',
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
      <Text
        numberOfLines={1}
        style={[
          styles.filterPillText,
          {
            color: active ? '#FFFFFF' : isDark ? '#A1A1AA' : '#475569',
            flexShrink: maxWidth != null ? 1 : undefined,
          },
        ]}>
        {label}
      </Text>
      {trailing}
    </Pressable>
  )
}

function FilterPills({
  filter,
  onChange,
  isDark,
  cityFilter,
  onCityPress,
}: {
  filter: ListFilter
  onChange: (f: ListFilter) => void
  isDark: boolean
  cityFilter: string | null
  onCityPress: () => void
}) {
  const cityActive = cityFilter != null
  return (
    <View style={styles.filterWrap}>
      <Text style={[styles.sheetTitle, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>Nearby courts</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterScroll}>
        {/* All → City → Favorites → … */}
        <FilterPillButton
          label="All"
          active={filter === 'all'}
          isDark={isDark}
          onPress={() => onChange('all')}
        />
        <FilterPillButton
          label={cityActive ? cityFilter! : 'City'}
          active={cityActive}
          isDark={isDark}
          onPress={onCityPress}
          maxWidth={160}
          trailing={
            <MaterialIcons
              name="arrow-drop-down"
              size={18}
              color={cityActive ? '#FFFFFF' : isDark ? '#A1A1AA' : '#475569'}
            />
          }
        />
        {FILTER_OPTIONS.filter((opt) => opt.key !== 'all').map((opt) => (
          <FilterPillButton
            key={opt.key}
            label={opt.label}
            active={filter === opt.key}
            isDark={isDark}
            onPress={() =>
              filter === opt.key && opt.key === 'favorites' ? onChange('all') : onChange(opt.key)
            }
          />
        ))}
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
      <CourtsOpenBadge
        liveCourtsAvailable={item.liveCourtsAvailable}
        liveOpenTotal={item.liveOpenTotal}
        liveBusyCount={item.liveBusyCount}
        liveUnknownCount={item.liveUnknownCount}
        courtCount={item.courtCount}
        status={item.status}
        isDark={isDark}
      />
    </Pressable>
  )
}

const SHEET_SKELETON_KEYS = ['sk1', 'sk2', 'sk3', 'sk4'] as const

type NearbyCourtsSheetProps = {
  courts: CourtWithDistance[]
  filter: ListFilter
  onFilterChange: (f: ListFilter) => void
  /** Active city name, or null for all nearby cities. */
  cityFilter: string | null
  onCityFilterChange: (city: string | null) => void
  /** Distinct cities from the nearby (5 mi) set for the picker. */
  cityOptions: string[]
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
    cityFilter,
    onCityFilterChange,
    cityOptions,
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
  const [cityPickerOpen, setCityPickerOpen] = useState(false)

  const peekSnapPx = useMemo(
    () => Math.round(PEEK_CONTENT_PX + insets.bottom),
    [insets.bottom],
  )
  const snapPoints = useMemo(() => [peekSnapPx, EXPANDED_SNAP], [peekSnapPx])

  const openCityPicker = useCallback(() => setCityPickerOpen(true), [])
  const closeCityPicker = useCallback(() => setCityPickerOpen(false), [])

  const selectCity = useCallback(
    (city: string | null) => {
      onCityFilterChange(city)
      setCityPickerOpen(false)
    },
    [onCityFilterChange],
  )

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
        <FilterPills
          filter={filter}
          onChange={onFilterChange}
          isDark={isDark}
          cityFilter={cityFilter}
          onCityPress={openCityPicker}
        />
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
    [filter, onFilterChange, isDark, cityFilter, openCityPicker, listFindingCourts],
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

  const cityPicker = (
    <Modal visible={cityPickerOpen} transparent animationType="fade" onRequestClose={closeCityPicker}>
      <Pressable style={styles.cityPickerBackdrop} onPress={closeCityPicker}>
        <Pressable
          style={[
            styles.cityPickerCard,
            {
              backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF',
              borderColor: isDark ? '#3F3F46' : '#E2E8F0',
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
          onPress={(e) => e.stopPropagation()}>
          <Text style={[styles.cityPickerTitle, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>Filter by city</Text>
          <ScrollView style={styles.cityPickerScroll} keyboardShouldPersistTaps="handled">
            <Pressable
              onPress={() => selectCity(null)}
              style={({ pressed }) => [
                styles.cityPickerRow,
                {
                  backgroundColor: cityFilter == null ? (isDark ? 'rgba(29,158,117,0.18)' : '#ECFDF5') : 'transparent',
                  opacity: pressed ? 0.85 : 1,
                },
              ]}>
              <Text
                style={[
                  styles.cityPickerRowText,
                  {
                    color: cityFilter == null ? BRAND_GREEN : isDark ? '#E4E4E7' : '#334155',
                    fontWeight: cityFilter == null ? '700' : '500',
                  },
                ]}>
                All cities
              </Text>
              {cityFilter == null ? <MaterialIcons name="check" size={20} color={BRAND_GREEN} /> : null}
            </Pressable>
            {cityOptions.map((city) => {
              const selected = cityFilter === city
              return (
                <Pressable
                  key={city}
                  onPress={() => selectCity(city)}
                  style={({ pressed }) => [
                    styles.cityPickerRow,
                    {
                      backgroundColor: selected ? (isDark ? 'rgba(29,158,117,0.18)' : '#ECFDF5') : 'transparent',
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.cityPickerRowText,
                      {
                        color: selected ? BRAND_GREEN : isDark ? '#E4E4E7' : '#334155',
                        fontWeight: selected ? '700' : '500',
                      },
                    ]}>
                    {city}
                  </Text>
                  {selected ? <MaterialIcons name="check" size={20} color={BRAND_GREEN} /> : null}
                </Pressable>
              )
            })}
            {cityOptions.length === 0 ? (
              <Text style={[styles.cityPickerEmpty, { color: isDark ? '#A1A1AA' : '#64748B' }]}>
                No cities in this area yet
              </Text>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )

  if (Platform.OS === 'web') {
    return (
      <>
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
          <FilterPills
            filter={filter}
            onChange={onFilterChange}
            isDark={isDark}
            cityFilter={cityFilter}
            onCityPress={openCityPicker}
          />
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
                extraData={`${filter}:${cityFilter ?? ''}`}
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
        {cityPicker}
      </>
    )
  }

  return (
    <>
      <BottomSheet
        index={0}
        snapPoints={snapPoints}
        enablePanDownToClose={false}
        enableOverDrag={false}
        enableDynamicSizing={false}
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
              extraData={`${filter}:${cityFilter ?? ''}`}
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
      {cityPicker}
    </>
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
    // Avoid flex:1 here — it can trap the sheet at an oversized height and fight snap points.
    zIndex: 20,
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
  cityPickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  cityPickerCard: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: '55%',
    paddingTop: 14,
  },
  cityPickerTitle: {
    fontSize: 17,
    fontWeight: '700',
    paddingHorizontal: 18,
    marginBottom: 8,
  },
  cityPickerScroll: {
    paddingHorizontal: 8,
  },
  cityPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  cityPickerRowText: {
    flex: 1,
    fontSize: 16,
  },
  cityPickerEmpty: {
    textAlign: 'center',
    paddingVertical: 24,
    fontSize: 14,
  },
})
