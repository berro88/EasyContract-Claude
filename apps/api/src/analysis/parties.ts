// Finds who a document names, and spots a named party being swapped for a
// term the document never defines (e.g. "Sample Client Ltd" → "the Client").

import type { PartyChange } from '@easycontract/shared';
import { wordDiff } from './align.ts';

const COMPANY = /\b[A-Z][\w&'-]*(?:\s+(?:[A-Z][\w&'-]*|&|of))*\s+(?:\(Pty\)\s+)?(?:Ltd|Limited|Inc|LLC|GmbH|plc|PLC|CC|Corporation|Corp|LLP)\b\.?/g;
const DEFINED_PAREN = /\((?:the\s+|hereinafter\s+(?:referred\s+to\s+as\s+)?(?:the\s+)?)?["“]([^"”\n]{1,40})["”]\)/g;
const DEFINED_MEANS = /["“]([A-Z][^"”\n]{0,40})["”]\s+(?:means|shall mean|refers to|includes)\b/g;

// Words that start a line or sentence but aren't part of a name ("Dear Acme Ltd").
const LEADING = /^(?:(?:Dear|Re|To|Attention|Attn|From|For|Between|And|Messrs|Signed|Per|By|With|This|The|Our|Your)\s+)+/;

export function companyNames(text: string): string[] {
  return [...new Set([...text.matchAll(COMPANY)].map((m) => m[0].replace(/\.$/, '').trim().replace(LEADING, '')).filter((n) => /\s/.test(n)))];
}

/** Terms a document defines: ("Supplier"), "Services" means …, plus company names it states. */
export function definedTerms(texts: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) {
    for (const m of t.matchAll(DEFINED_PAREN)) out.add(m[1].trim());
    for (const m of t.matchAll(DEFINED_MEANS)) out.add(m[1].trim());
    for (const c of companyNames(t)) out.add(c);
  }
  return out;
}

const PLACEHOLDER = '⟨PARTY⟩';
const CAPITALISED = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;

/**
 * Compares one clause before and after. If a party named on the left is gone
 * on the right and replaced by a capitalised term the right-hand document
 * doesn't define, report it.
 */
export function detectPartyChange(input: {
  leftText: string;
  rightText: string;
  leftBlockId: string;
  rightBlockId: string;
  leftNames: Set<string>;
  rightDefined: Set<string>;
}): PartyChange | null {
  const { leftText, rightText, leftNames, rightDefined } = input;
  // Longest names first, so "Sample Client Ltd" wins over "Client".
  const names = [...leftNames].sort((a, b) => b.length - a.length);
  const removed = names.find((n) => leftText.includes(n) && !rightText.includes(n));
  if (!removed) return null;

  // Words added anywhere in this clause, now that the name is gone from it.
  const ops = wordDiff(leftText.split(removed).join(PLACEHOLDER), rightText);
  if (!ops.some((o) => o.op === 'remove' && o.text.includes(PLACEHOLDER))) return null;
  const added = ops.filter((o) => o.op === 'add').map((o) => o.text).join(' ');
  {
    for (const m of added.matchAll(CAPITALISED)) {
      const term = m[1];
      if (rightDefined.has(term) || term === 'The') continue;
      return {
        leftBlockId: input.leftBlockId,
        rightBlockId: input.rightBlockId,
        from: removed,
        to: term,
        message: `"${removed}" was changed to "${term}", but the newer wording never defines "${term}". It may be unclear who that refers to.`,
      };
    }
  }
  return null;
}
