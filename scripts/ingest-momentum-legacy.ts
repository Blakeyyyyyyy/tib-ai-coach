/**
 * Re-ingest the 4 legacy Momentum JSON files (generic video_name "Momentum Meet").
 * Does not rename files on disk — only updates DB titles + embeddings from filename.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { ingestJsonTranscriptFile } from './ingest-json-transcripts';

config({ path: resolve(process.cwd(), '.env') });

const LEGACY = [
  'momentum_meet.json',
  'momentum_meet_1143260246.json',
  'momentum_meet_1136289171.json',
  'momentum_meet_1133307969.json',
];

async function main() {
  const openai = process.env.OPENAI_API_KEY;
  if (!openai) {
    console.error('OPENAI_API_KEY required');
    process.exit(1);
  }

  console.log(`Re-ingesting ${LEGACY.length} legacy Momentum file(s)…\n`);

  for (const file of LEGACY) {
    console.log(`→ ${file}`);
    const r = await ingestJsonTranscriptFile(file, { openaiKey: openai });
    console.log(`  ${r.chunkCount} chunks (delete-then-insert, no duplicates)\n`);
  }

  console.log('Done. Run: npx tsx scripts/inspect-momentum-legacy-db.ts');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
