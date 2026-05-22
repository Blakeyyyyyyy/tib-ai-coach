/**
 * Write transcript from file → JSON chunks → optional ingest. Deletes input unless --keep-input.
 *
 * Usage:
 *   tsx scripts/transcript-auto-pipeline.ts <transcript.txt> <out.json> "Video Name" "url" [--ingest]
 */

import { spawn } from 'child_process';
import { resolve } from 'path';

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: false,
    });
    p.on('close', (code) => (code === 0 ? res() : rej(new Error(`exit ${code}`))));
  });
}

async function main() {
  const args = process.argv.slice(2);
  const ingest = args.includes('--ingest');
  const filtered = args.filter((a) => a !== '--ingest');
  const [inPath, outJson, videoName, videoUrl] = filtered;
  if (!inPath || !outJson || !videoName || !videoUrl) {
    console.error(
      'Usage: tsx scripts/transcript-auto-pipeline.ts <in.txt> <out.json> "Name" "url" [--ingest]'
    );
    process.exit(1);
  }

  await run('npx', [
    'tsx',
    'scripts/transcript-text-to-json.ts',
    inPath,
    outJson,
    videoName,
    videoUrl,
    '--rm-input',
  ]);

  if (ingest) {
    const base = resolve(process.cwd(), outJson).split(/[/\\]/).pop()!;
    await run('npm', ['run', 'ingest:json', '--', base]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
