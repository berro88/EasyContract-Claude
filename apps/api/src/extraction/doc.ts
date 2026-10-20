import WordExtractor from 'word-extractor';
import { type ExtractionResult, type RawBlock, UnsupportedFileError, assessQuality, typedClauseNumber } from './common.ts';

/**
 * Reads old Word 97-2003 (.doc) files locally. The format has no paragraph
 * ids, so each block is anchored by its paragraph's position in the body
 * text; re-reading the same file always gives the same positions.
 */
export async function extractDoc(bytes: Uint8Array): Promise<ExtractionResult> {
  let body: string;
  try {
    body = (await new WordExtractor().extract(Buffer.from(bytes))).getBody();
  } catch {
    throw new UnsupportedFileError('This file is not a readable Word (.doc) document. Open it in Word, save it as .docx and upload again.');
  }
  const blocks: RawBlock[] = [];
  body.split(/\r?\n/).forEach((line, paragraphIndex) => {
    const text = line.replace(/[\u0007\u000b\u000c]/g, ' ').trim();
    if (!text) return;
    blocks.push({ kind: 'paragraph', clauseNumber: typedClauseNumber(text), text, anchor: { format: 'doc', paragraphIndex } });
  });
  const chars = blocks.reduce((n, b) => n + b.text.length, 0);
  return { format: 'doc', pageCount: Math.max(1, Math.ceil(chars / 3000)), blocks, unreadable: assessQuality(blocks, 'docx', null) };
}
