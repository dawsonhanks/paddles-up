/** Empty-state copy for the Play tab (My Sessions + Find a Game). */

export const PLAY_TAB_EMPTY_COPY = {
  sessions: {
    /** When offline in My Sessions */
    offlineMessage: 'Sessions need a connection to load.',
    /** When online and there are no upcoming sessions */
    noUpcoming: 'No upcoming sessions scheduled yet.',
  },
  findGame: {
    /** Full empty list (no posts at all) */
    noGamesPostedTitle: 'No games posted yet',
    noGamesPostedSub: 'Be the first to post — tap the + button.',
    /** “Other games” section empty but user has “My games” */
    noOtherGames: 'No other games right now.',
  },
} as const
