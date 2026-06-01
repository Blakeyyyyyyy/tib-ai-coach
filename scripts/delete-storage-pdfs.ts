import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env') });

const BUCKET = process.env.RAG_STORAGE_BUCKET ?? 'Rag';
const files = process.argv.slice(2);

async function main() {
  if (files.length === 0) {
    console.error('Usage: npx tsx scripts/delete-storage-pdfs.ts file1.pdf file2.pdf');
    process.exit(1);
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { error } = await admin.storage.from(BUCKET).remove(files);
  if (error) {
    console.error('Delete failed:', error.message);
    process.exit(1);
  }
  for (const f of files) console.log('deleted', f);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
