import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const dir = resolve('data/json');
const withUrl: string[] = [];
const noUrl: string[] = [];

for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const items = JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as unknown[];
  const arr = Array.isArray(items) ? items : [];
  const has = arr.some(
    (c) =>
      (c as { video_url?: string }).video_url?.trim() &&
      !String((c as { video_url?: string }).video_url).includes('example.com')
  );
  (has ? withUrl : noUrl).push(f);
}

const pick = (arr: string[], n: number, step: number) =>
  arr.filter((_, i) => i % step === 0).slice(0, n);

const usedWithUrl = new Set([
  'How To Cashflow Forecast.json',
  'Expert Session with Dani Ferrier.json',
  'Expert Session with Kristy Lee.json',
  '5 Ideas for Toolbox Talk.json',
  'Canva with Sugarpop Social.json',
  'Managing Debtors.json',
  'momentum_meet_march_11.json',
  'Expert Session with Bold Wealth.json',
  'Momentum_Meet_20_August_2025.json',
  'TIB How to work with your partner.json',
]);
const freshWithUrl = withUrl.filter((f) => !usedWithUrl.has(f));

console.log('WITH_URL_TOTAL', withUrl.length);
console.log('FRESH_WITH_URL', freshWithUrl.length);
pick(freshWithUrl, 5, 17).forEach((f) => console.log('WITH', f));
console.log('NO_URL_TOTAL', noUrl.length);
pick(noUrl, 5, 6).forEach((f) => console.log('NO', f));
