// A small document model shared by the Word and PDF writers, so every export
// is built the same way and always carries the disclaimer.

export type Tone = 'red' | 'amber' | 'green' | 'neutral';

export type ReportBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string; muted?: boolean; bold?: boolean }
  | { type: 'quote'; text: string; label?: string }
  | { type: 'label'; text: string; tone: Tone }
  | { type: 'bullets'; items: string[] }
  | { type: 'warning'; text: string }
  | { type: 'rule' };

export interface ReportDoc {
  title: string;
  /** Short lines under the title (document, version, date). */
  meta: string[];
  blocks: ReportBlock[];
  /** Printed on every page. */
  disclaimer: string;
}

export const TONE_COLOURS: Record<Tone, string> = { red: 'B42318', amber: '8A5A00', green: '1F7A45', neutral: '444444' };
