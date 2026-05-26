/**
 * Ingest transcript JSON files under data/json (skips already-ingested).
 * Usage: npx tsx scripts/ingest-json-batch.ts
 */

import { execSync } from 'child_process';
import fs from 'fs';
import { resolve, join } from 'path';

/** Already embedded in knowledge_chunks — do not re-run */
const SKIP = new Set([
  'transcript_chunks.json',
  'budget_vs_actual_spreadsheet.json',
  'should_you_charge_for_quotes.json',
  'hourly_rate_calculator_transcript.json',
  'momentum_apr_8.json',
  'momentum_meet_march_4.json',
  'momentum_jan_21.json',
  'momentum_meet.json',
  'momentum_meet_feb_25.json',
  'momentum_meet_march_11.json',
  'momentum_meet_1143260246.json',
  'momentum_meet_nov_19.json',
  'momentum_meet_1136289171.json',
  'momentum_meet_1133307969.json',
  'Momentum_Meet_April_22.json',
  'Momentum Meet April 29.json',
  'Momentum_Meet_04_June_2025.json',
  'Momentum_Meet_10_September_2025.json',
  'Momentum_Meet_11_June_2025.json',
  'Momentum_Meet_13_August_2025.json',
  'Momentum_Meet_14_May_2025.json',
  'Momentum_Meet_16_July_2025.json',
  'Momentum_Meet_18_June_2025.json',
  'Momentum_Meet_20_August_2025.json',
  'Momentum_Meet_20_May_2025.json',
  'Momentum_Meet_22_October_2025.json',
  'Momentum_Meet_23_July_2025.json',
  'Momentum_Meet_25_June_2025.json',
  'Momentum_Meet_27_August_2025.json',
  'Momentum_Meet_28_May_2025.json',
  'Momentum_Meet_29_October_2025.json',
  'Momentum_Meet_30_July_2025.json',
  'Momentum_Meet_3_September_2025.json',
  'Momentum_Meet_6_August_2025.json',
  'Momentum_Meet_7_May_2025.json',
  'Momentum_Meet_8_October_2025.json',
  'Momentum_Meet_9_July_2025.json',
  'Creating Wealth In Chaos The Secrets To Building Wealth In Uncertain Times.json',
  'Done With You Session on Backcosting.json',
  'Expert Session with Bold Wealth.json',
  'Financial Jam.json',
  'Financial Jam with Jackson Millan.json',
  'Financial Jam with Two Drunk Accountants.json',
  'How To Cashflow Forecast.json',
  'How to Use the Budget vs Actual Spreadsheet.json',
  'Managing Debtors.json',
  'Understanding the Five Profit Levers with Tradies In Business.json',
  '5 Ideas for Toolbox Talk.json',
  'Done With You Session with Nic & Waz on Meeting Structure.json',
  'Expert Sessin with Mick.json',
  'Expert Session w. Kristy Lee Billet.json',
  'Expert Session with Dani Ferrier.json',
  'Expert Session with Kristy Lee.json',
  'Expert Session with Sarah Greener.json',
  'Expert Webinar with Kristy-Lee from The Footprint Group.json',
  'Giving Feedback.json',
  'Mini Systems Sprint - Business Meeting Structure.json',
  'Done With You - Leads Tracking & Marketing Q&A(1).json',
  'Done With You - Marketing & AI(1).json',
  'Done With You - Tradie Systems Map(1).json',
  'Done With You Session on Identifying Your A,B, C and D Clients(1).json',
  'Done With You Session on Using AI in your Trade Business(1).json',
  'Expert Session - Potential of AI in Your Business with Blake(1).json',
  'Expert Session with Dale Stephens from Sophiie AI(1).json',
  'Expert Session with Michael Griffiths(1).json',
  'Expert Session with Rhys from Kaha Digital(1).json',
  'Finding Daily Focus(1).json',
  'Life and Wealth Planning(1).json',
  'Must Do Marketing Webinar(1).json',
  'Tradiepreneur Review(1).json',
  'Expert Session w. Dr Ash Moreland.json',
  'Expert Session with Josie Askin.json',
  'Expert Session with John & Amanda - Retune.json',
  'Get Ready for EOFY Webinar.json',
  'How to Find and Keep Good Staff During a Recession.json',
  'How To Say No To Crappy Jobs.json',
  'How to Reduce Cash Flow Stress.json',
  'Marketing to Survive Tough Times.json',
  'Q&A Expert Session with Nicole Davidson.json',
  'Done With You Session HR System For Success.json',
  'HR Compliance Essentials for Tradies in Business.json',
  'How to Work with the Younger Generation with Cal Robinson from Young Gunz.json',
  'Write Your Sexy Job Ad (Sexy Ad Builder).json',
  'Overcoming Communication Challenges and Reconnecting with Your Partner with Megs Dixon.json',
  'Client Avatar.json',
  'Demo and Q&A Expert Session.json',
  'Done with You Session  Creating Company Values & Mission Vision Statement.json',
  'Done With You Session with Nic & Waz.json',
  'Expert Session with Matt Heighway.json',
  'Expert Webinar with Joe Pane.json',
  'Getting the Most Out of the Tradiepreneur Program.json',
  'HR for Tradies in Business.json',
  'Influence and Profit Accelerator with Joe Pane.json',
  'Overcoming Communication Challenges with Your Partner with Megs Dixon.json',
  'Q&A Expert Webinar.json',
  'Trade-O with Renee Boardman.json',
  'Tradiepreneur Financial Dashboard.json',
  '7 Myths of Systemising your Business with James Brown.json',
  'Clea Jones on The 9 Mental Roadblocks Stopping You From Being a Content Marketing Rockstar.json',
  "Done with You Session - Scripts for Sales & Enquiries.json",
  "Done With You Session Create your 'right now' marketing plan & leads budget.json",
  'Done with You Session Improve Conversion By Mapping Your Sales Process.json',
  'Expert Session on Google My Business Local Service Ads with Nicholas Dogulin.json',
  'Expert Sessions Done with You Screening Questions.json',
  'One Page Wealth Plan with Jackson Millan.json',
  'Preparing Your Trade Business for Facebook and Success with Amy Wyhoon.json',
  'Social Media Scheduling.json',
  'Turning Your Ideas Into Content with Sam Winch.json',
]);

const root = resolve(process.cwd());
const jsonDir = join(root, 'data', 'json');
const script = resolve(root, 'scripts', 'ingest-json-transcripts.ts');

function isReadyForIngest(filePath: string): boolean {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    return (
      Array.isArray(data) &&
      data.length > 0 &&
      typeof (data[0] as { video_name?: string; text?: string })?.video_name ===
        'string' &&
      typeof (data[0] as { text?: string })?.text === 'string'
    );
  } catch {
    return false;
  }
}

function run(file: string): void {
  console.log(`\n========== ${file} ==========\n`);
  execSync(`npx tsx ${JSON.stringify(script)} ${JSON.stringify(file)}`, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    shell: false,
  });
}

const all = fs
  .readdirSync(jsonDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

const toIngest = all.filter((f) => !SKIP.has(f) && isReadyForIngest(join(jsonDir, f)));

const pending = all.filter((f) => !SKIP.has(f) && !isReadyForIngest(join(jsonDir, f)));

console.log(`Ingesting ${toIngest.length} ready file(s) (${SKIP.size} skipped)…`);
if (pending.length) {
  console.log(`Pending (need transcript / run prepare:json first):`);
  pending.forEach((f) => console.log(`  - ${f}`));
}
console.log('');

let ok = 0;
let fail = 0;
for (const file of toIngest) {
  try {
    run(file);
    ok++;
  } catch (e) {
    fail++;
    console.error(`Failed: ${file}`, e instanceof Error ? e.message : e);
  }
}
console.log(`\nDone. Ingested ${ok} file(s).${fail ? ` Failed: ${fail}.` : ''}`);
if (fail) process.exit(1);
