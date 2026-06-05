/**
 * Derive a distinct session title from the JSON filename when transcripts
 * use a generic video_name (e.g. all "Momentum Meet") — no file renames required.
 */

const GENERIC_MOMENTUM = /^momentum\s+meet$/i;

export function isGenericMomentumMeetTitle(videoName: string): boolean {
  return GENERIC_MOMENTUM.test(videoName.trim());
}

/** True for very generic single-title sessions that need filename disambiguation. */
export function needsFilenameSessionTitle(
  videoName: string,
  sourceFile?: string | null
): boolean {
  if (!sourceFile?.endsWith('.json')) return false;
  return isGenericMomentumMeetTitle(videoName);
}

/**
 * Build a unique, human-readable session title from the JSON filename.
 * Original JSON on disk is never modified.
 */
export function sessionTitleFromJsonFilename(
  sourceFile: string,
  videoName: string
): string {
  const base = sourceFile.replace(/\.json$/i, '').trim();

  const dated = base.match(/^Momentum[_ ]Meet[_ ](.+)$/i);
  if (dated) {
    const rest = dated[1]!.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    if (rest && !/^\d+$/.test(rest)) {
      return `Momentum Meet ${rest}`;
    }
  }

  const numericId = base.match(/^momentum[_ ]meet[_ ]?(\d{6,})$/i);
  if (numericId) {
    return `Momentum Meet (recording ${numericId[1]})`;
  }

  if (/^momentum[_ ]meet$/i.test(base)) {
    return 'Momentum Meet (legacy archive)';
  }

  const pretty = base
    .replace(/[_-]+/g, ' ')
    .replace(/\(\d+\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (pretty.length > 12) return pretty;

  return videoName.trim() || 'Video session';
}

export function resolveTranscriptSessionTitle(
  sourceFile: string | null | undefined,
  videoName: string,
  sourceTitle?: string
): string {
  const vn = videoName.trim() || sourceTitle?.trim() || 'Video';
  if (sourceFile && needsFilenameSessionTitle(vn, sourceFile)) {
    return sessionTitleFromJsonFilename(sourceFile, vn);
  }
  return vn;
}
