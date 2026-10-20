// Pulls figures out of a clause as exact quotes. Nothing is calculated or
// converted: what you see is a substring of the source block.

import type { QuotedFact } from '@easycontract/shared';

const NUMBER_WORD = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|fifteen|twenty|thirty|forty-?five|forty|sixty|ninety)';

const PATTERNS: { kind: QuotedFact['kind']; label: string; re: RegExp }[] = [
  {
    kind: 'period',
    label: 'Time period',
    re: new RegExp(`\\b(?:(?:\\d+|${NUMBER_WORD})(?:\\s*\\(\\d+\\))?)\\s+(?:business |calendar |working |clear )?(?:days?|weeks?|months?|years?)(?:'|’)?`, 'gi'),
  },
  { kind: 'amount', label: 'Amount', re: /(?:\b(?:ZAR|USD|EUR|GBP|R)\s?|[$€£]\s?)\d[\d,\s]*\d(?:\.\d+)?\b|(?:\b(?:ZAR|USD|EUR|GBP|R)\s?|[$€£]\s?)\d\b/g },
  { kind: 'percentage', label: 'Percentage', re: /\b\d+(?:[.,]\d+)?\s?(?:%|per ?cent)/gi },
  { kind: 'placeholder', label: 'Unfilled placeholder', re: /\[[^\]\n]{1,60}\]|_{3,}|\.{5,}|<[^>\n]{1,40}>/g },
  { kind: 'defined_term', label: 'Defined term', re: /\((?:the\s+)?["“]([^"”\n]{1,40})["”]\)/g },
];

export function extractFacts(text: string, sourceBlockId: string): QuotedFact[] {
  const facts: QuotedFact[] = [];
  const seen = new Set<string>();
  for (const { kind, label, re } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const quote = m[0].trim();
      const key = `${kind}|${quote}`;
      if (!quote || seen.has(key)) continue;
      seen.add(key);
      facts.push({ kind, label, quote, sourceBlockId });
    }
  }
  return facts;
}
