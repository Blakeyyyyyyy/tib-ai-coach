/**
 * When to trust title-keyword anchors vs vector consensus.
 * Prevents generic words ("systems", "pricing", "help") from forcing wrong sessions.
 */

import {
  entityAnchorTerms,
  hasEntityStyleTerms,
  salientQueryTerms,
  titleSearchTerms,
} from '@/lib/ai/rag-query-terms';

/** Words that match too many unrelated session titles on their own. */
const GENERIC_COACHING_TERMS = new Set([
  'help',
  'need',
  'systems',
  'system',
  'pricing',
  'price',
  'project',
  'projects',
  'business',
  'trade',
  'money',
  'losing',
  'fix',
  'margin',
  'margins',
  'job',
  'jobs',
  'work',
  'financial',
  'marketing',
  'sales',
  'team',
  'client',
  'quote',
]);

/** Sessions that often win title-keyword on incidental generic overlap. */
export function isGenericTitleKeywordCollisionTitle(title: string): boolean {
  const t = title.toLowerCase();
  return (
    /using ai in your trade/i.test(t) ||
    /mindmeister/i.test(t) ||
    /systems mapping using mindmeister/i.test(t) ||
    /trade[- ]?o with renee/i.test(t) ||
    (/momentum meet/i.test(t) && /\bjuly\b/i.test(t))
  );
}

/** True when the only query↔title overlap is generic coaching vocabulary. */
export function titleMatchUsesOnlyGenericTerms(
  userQuery: string,
  title: string
): boolean {
  if (entityAnchorTerms(userQuery).length > 0) return false;

  const tl = title.toLowerCase();
  const terms = [
    ...titleSearchTerms(userQuery, 8),
    ...salientQueryTerms(userQuery, 8),
  ];

  let hasGeneric = false;
  let hasSpecific = false;

  for (const term of terms) {
    const t = term.toLowerCase();
    if (t.length < 3 || !tl.includes(t)) continue;
    if (GENERIC_COACHING_TERMS.has(t) || t.length < 5) {
      hasGeneric = true;
    } else {
      hasSpecific = true;
    }
  }

  return hasGeneric && !hasSpecific;
}

export type TitleAnchorPolicyInput = {
  userQuery: string;
  titleAnchorKey: string;
  anchorTitle: string;
  vectorConsensus: string | null;
  topicRoutedKeys: string[];
};

/**
 * Whether title-keyword should force a doc into the session pool or rerank order.
 * Entity-named queries keep full title anchoring; generic coaching queries defer to vector/topics.
 */
export function shouldPromoteTitleKeywordAnchor(
  input: TitleAnchorPolicyInput
): boolean {
  const {
    userQuery,
    titleAnchorKey,
    anchorTitle,
    vectorConsensus,
    topicRoutedKeys,
  } = input;

  if (hasEntityStyleTerms(userQuery)) return true;

  if (
    topicRoutedKeys.length > 0 &&
    !topicRoutedKeys.includes(titleAnchorKey)
  ) {
    return false;
  }

  if (isGenericTitleKeywordCollisionTitle(anchorTitle)) {
    return false;
  }

  if (titleMatchUsesOnlyGenericTerms(userQuery, anchorTitle)) {
    return false;
  }

  if (vectorConsensus && vectorConsensus !== titleAnchorKey) {
    return false;
  }

  return true;
}

/** Filter title-keyword hit force-keys for generic queries when vector/topics disagree. */
export function filterTitleKeywordForceKeys(
  userQuery: string,
  keys: string[],
  vectorConsensus: string | null,
  topicRoutedKeys: string[],
  trustVectorConsensus = true
): string[] {
  if (hasEntityStyleTerms(userQuery)) return keys;

  const allowed = new Set<string>();
  if (vectorConsensus && trustVectorConsensus) allowed.add(vectorConsensus);
  for (const k of topicRoutedKeys) allowed.add(k);

  if (allowed.size === 0) return [];

  return keys.filter((k) => allowed.has(k));
}
