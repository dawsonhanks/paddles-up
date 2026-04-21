/**
 * Metro loads `court-map.native` / `court-map.web` before this file.
 * This re-export keeps ESLint and other tools that lack `moduleSuffixes` happy.
 */
export { CourtMap, type CourtMapProps } from './court-map.web'
