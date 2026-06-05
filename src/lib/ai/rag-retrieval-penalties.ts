/**
 * Thin compatibility layer — all disambiguation logic lives in rag-topic-engine + rag-topic-catalog.
 */

import type { MatchRow } from '@/lib/ai/rag-merge';
import type { PhraseChunkRow } from '@/lib/ai/rag-phrase-search';
import {
  applyTopicSessionScores,
  correctPrimaryForActiveTopics,
  isQueryForTopic,
  shouldSingleCitationForRoutedTopic,
} from '@/lib/ai/rag-topic-engine';
import type { SessionRoute } from '@/lib/ai/rag-session-router';

export function isContentCreationQuery(userQuery: string): boolean {
  return isQueryForTopic(userQuery, 'content_storytelling');
}

export function isJoePaneImprovQuery(userQuery: string): boolean {
  return isQueryForTopic(userQuery, 'joe_pane_improv');
}

export function isTeamMeetingRhythmQuery(userQuery: string): boolean {
  return isQueryForTopic(userQuery, 'nic_waz_meeting');
}

export function isJobBoardSessionTitle(title: string): boolean {
  const t = title.toLowerCase();
  return (
    /\btrade[- ]?o\b/i.test(t) ||
    /renee boardman/i.test(t) ||
    /\btradeo\b/i.test(t)
  );
}

export function isContentSessionTitle(title: string): boolean {
  const t = title.toLowerCase();
  return (
    /sam winch/i.test(t) ||
    /turning your ideas into content/i.test(t) ||
    (/clea jones/i.test(t) && /content marketing|mental roadblocks/i.test(t)) ||
    /social media scheduling/i.test(t)
  );
}

export function isJoePaneImprovSessionTitle(title: string): boolean {
  const t = title.toLowerCase();
  return (
    /expert webinar with joe pane/i.test(t) ||
    (/joe pane/i.test(t) && /webinar|improv|influence|profit accelerator/i.test(t))
  );
}

export function isNicWazMeetingSessionTitle(title: string): boolean {
  const t = title.toLowerCase();
  return (
    /nic.*waz.*meeting structure/i.test(t) ||
    /meeting structure.*nic.*waz/i.test(t) ||
    /done with you session with nic.*waz on meeting structure/i.test(t)
  );
}

export function isGenericLeadershipCollisionTitle(title: string): boolean {
  const t = title.toLowerCase();
  if (isNicWazMeetingSessionTitle(title)) return false;
  return (
    /^leadership skills$/i.test(t.trim()) ||
    /leadership skills/i.test(t) ||
    /expert sessin with mick/i.test(t) ||
    (/^how to be a leader\b/i.test(t) && !/meeting structure/i.test(t)) ||
    (/momentum meet/i.test(t) && !/meeting structure/i.test(t))
  );
}

export function applyAllQueryAwareSessionPenalties(
  userQuery: string,
  sessionScores: Map<string, number>,
  matches: MatchRow[],
  titleKeywordRows: PhraseChunkRow[],
  rowDocKey: (row: MatchRow) => string,
  rowTitle: (row: MatchRow) => string,
  sessionRoute?: SessionRoute | null
): void {
  applyTopicSessionScores(
    userQuery,
    sessionRoute ?? null,
    sessionScores,
    matches,
    titleKeywordRows,
    rowDocKey,
    rowTitle
  );
}

export function correctMisroutedPrimaryDocKey(
  primaryKey: string,
  userQuery: string,
  rerankMatches: MatchRow[],
  vectorMatches: MatchRow[],
  rowDocKey: (row: MatchRow) => string,
  rowTitle: (row: MatchRow) => string,
  sessionRoute?: SessionRoute | null
): string {
  return correctPrimaryForActiveTopics(
    primaryKey,
    userQuery,
    sessionRoute ?? null,
    rerankMatches,
    vectorMatches,
    rowDocKey,
    rowTitle
  );
}

export function shouldSingleCitationForMeetingRhythm(
  userQuery: string,
  primaryKey: string,
  rerankMatches: MatchRow[],
  rowDocKey: (row: MatchRow) => string,
  rowTitle: (row: MatchRow) => string,
  sessionRoute?: SessionRoute | null
): boolean {
  return shouldSingleCitationForRoutedTopic(
    userQuery,
    sessionRoute ?? null,
    primaryKey,
    rerankMatches,
    rowDocKey,
    rowTitle
  );
}
