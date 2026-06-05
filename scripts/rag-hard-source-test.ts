/**
 * Run hard source-targeted questions; report primary vs expected file.
 * Usage: npx tsx scripts/rag-hard-source-test.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { retrieveStorageRagWithDebug } from '../src/lib/ai/rag-storage';

config({ path: resolve(process.cwd(), '.env') });

type Case = {
  id: string;
  expectedFile: string;
  expectAny: string[];
  query: string;
};

const CASES: Case[] = [
  {
    id: 'pdf-debtor',
    expectedFile: 'Debtor-Management-Process-v.042025.pdf',
    expectAny: ['Debtor Management', 'Debtor-Management'],
    query:
      "Invoices are 45–90 days late and I'm doing ad-hoc chasing. What process should a trade business run weekly so debtors don't silently kill cash flow?",
  },
  {
    id: 'pdf-price-objection',
    expectedFile: 'Price-Objection-Handling-Script.pdf',
    expectAny: ['Price Objection', 'Objection Handling'],
    query:
      "A prospect says we're too expensive compared with a cheaper quote. What should I say on the spot without discounting or talking myself out of the job?",
  },
  {
    id: 'pdf-screen-customers',
    expectedFile: '10-Questions-That-Can-Be-Used-To-Screen-Customers.pdf',
    expectAny: ['Screen Customers', 'Screen-Customers'],
    query:
      "We're booked out but still saying yes to everyone and regretting it. What should we ask before committing so bad-fit clients never get a site visit?",
  },
  {
    id: 'pdf-hiring',
    expectedFile: 'Hiring-Cheat-Sheet.pdf',
    expectAny: ['Hiring Cheat', 'Hiring-Cheat'],
    query:
      "I need a second tradie in six weeks and I've never hired properly. What steps and checks should I run so I don't rush into the wrong person?",
  },
  {
    id: 'pdf-kpis',
    expectedFile: 'KPIs-How-To-Implement-v.042025.pdf',
    expectAny: ['KPIs', 'KPI'],
    query:
      "I track revenue in Xero but don't know if the business is actually improving. How do I pick a few KPIs and review them without drowning in spreadsheets?",
  },
  {
    id: 'json-no-avatar',
    expectedFile: 'Client Avatar.json',
    expectAny: ['Client Avatar', 'avatar'],
    query:
      "My marketing targets a dream client I can't actually win yet. What's the difference between a right-now avatar and an ideal avatar, and how should I choose work that fixes today's calendar gaps?",
  },
  {
    id: 'json-no-tradiepreneur',
    expectedFile: 'Getting the Most Out of the Tradiepreneur Program.json',
    expectAny: ['Tradiepreneur Program', 'Getting the Most Out'],
    query:
      "I've been in the program months but only use coaching when I'm in crisis. What habits actually get value from membership beyond turning up to calls?",
  },
  {
    id: 'json-no-buildxact',
    expectedFile: 'Demo and Q&A Expert Session.json',
    expectAny: ['Buildxact', 'Build xact', 'Demo and Q&A'],
    query:
      "We're outgrowing spreadsheets for quoting and job tracking. What did the Buildxact demo session cover that tradies should look for before switching systems?",
  },
  {
    id: 'json-no-hr',
    expectedFile: 'Done with You Session HR System For Success.json',
    expectAny: ['HR System', 'HR System For Success'],
    query:
      "Staff issues eat my week — warnings, performance, and paperwork are messy. What HR system pieces should a small trade business put in place before it becomes a legal mess?",
  },
  {
    id: 'json-no-marketing-budget',
    expectedFile:
      "Done with You Session Create your 'right now' marketing plan & leads budget.json",
    expectAny: ['marketing plan', 'leads budget', 'right now'],
    query:
      "I'm spending on ads but can't tell what's working. How should I build a simple right-now marketing plan and leads budget instead of guessing each month?",
  },
  {
    id: 'json-url-cf-challenge',
    expectedFile: 'CF Challenge 1.json',
    expectAny: ['CF Challenge', 'Cash Flow Challenge'],
    query:
      "Cash flow feels scary and I've been avoiding the numbers. What was the four-week cash flow challenge trying to get tradies to do step by step, and what tools sat in Trade Desk?",
  },
  {
    id: 'json-url-hazardco',
    expectedFile: 'Expert Session with HazardCo Talking Safety.json',
    expectAny: ['HazardCo', 'Safety'],
    query:
      "Safety paperwork on site is a mess and I worry about SWMS when we're busy. What practical approach did the HazardCo expert session recommend for keeping safety simple on residential jobs?",
  },
  {
    id: 'json-url-momentum-aug27',
    expectedFile: 'Momentum_Meet_27_August_2025.json',
    expectAny: ['27 August 2025', 'Momentum Meet 27'],
    query:
      "A big three-month job landed and the owner immediately talked himself out of it — mindset hadn't caught up with the business. What did coaches say about self-doubt when opportunities outgrow how you see yourself?",
  },
  {
    id: 'json-url-wealth-chaos',
    expectedFile:
      'Creating Wealth In Chaos The Secrets To Building Wealth In Uncertain Times.json',
    expectAny: ['Creating Wealth', 'Jackson Milan', 'Wealth In Chaos'],
    query:
      "Profit in the business is okay but nothing sticks personally — wealth keeps getting pushed aside. In uncertain times, what wealth-building habits did Jackson Milan stress for tradie owners?",
  },
  {
    id: 'json-url-leads-tracking',
    expectedFile: 'Done With You - Leads Tracking & Marketing Q&A(1).json',
    expectAny: ['Leads Tracking', 'Marketing Q&A', 'test and measure'],
    query:
      "Marketing spend is leaking — I can't tell which channel brings jobs that actually convert. What's the difference between the daily test-and-measure sheet and the detailed leads tracker, and how should I use one?",
  },
];

function primaryMatches(primary: string | null | undefined, c: Case): boolean {
  if (!primary) return false;
  const p = primary.toLowerCase();
  return c.expectAny.some((e) => p.includes(e.toLowerCase()));
}

async function main() {
  const openai = process.env.OPENAI_API_KEY?.trim();
  if (!openai || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    console.error('Need OPENAI_API_KEY and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  let pass = 0;
  for (const c of CASES) {
    const { result, debug } = await retrieveStorageRagWithDebug(c.query, openai);
    const primary = result?.primarySourceTitle ?? debug.primaryTitle;
    const ok = primaryMatches(primary, c);
    if (ok) pass++;
    console.log(
      `${ok ? 'PASS' : 'FAIL'} [${c.id}]`,
      '\n  expected:', c.expectedFile,
      '\n  got:     ', primary ?? '(none)',
      debug.routedTopicId ? `\n  route:   ${debug.routedTopicId}` : ''
    );
  }
  console.log(`\n=== ${pass}/${CASES.length} ===`);
  process.exit(pass === CASES.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
