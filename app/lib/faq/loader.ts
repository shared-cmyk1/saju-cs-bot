import fs from 'fs';
import path from 'path';

let cachedFAQ: string | null = null;
let cachedAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5분

export function loadFAQ(): string {
  const now = Date.now();
  if (cachedFAQ && now - cachedAt < CACHE_TTL) {
    return cachedFAQ;
  }

  const faqPath = path.join(process.cwd(), 'content', 'FAQ.md');
  cachedFAQ = fs.readFileSync(faqPath, 'utf-8');
  cachedAt = now;
  return cachedFAQ;
}
