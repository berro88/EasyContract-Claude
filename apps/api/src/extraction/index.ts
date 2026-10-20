import { extname } from 'node:path';
import { UPLOAD_LIMITS } from '@easycontract/shared';
import { type ExtractionResult, UnsupportedFileError } from './common.ts';
import { extractDocx } from './docx.ts';
import { extractPdf } from './pdf.ts';
import { extractDoc } from './doc.ts';

export { UnsupportedFileError } from './common.ts';
export type { ExtractionResult, RawBlock } from './common.ts';

export type FileKind = 'pdf' | 'docx' | 'doc';

export const MIME: Record<FileKind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
};

/** Identifies a file by its bytes, not just its name. */
export function detectFileKind(fileName: string, bytes: Uint8Array): FileKind {
  const ext = extname(fileName).toLowerCase();
  const head = Buffer.from(bytes.subarray(0, 8));
  const isOle = head.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
  if (!(UPLOAD_LIMITS.extensions as readonly string[]).includes(ext)) {
    throw new UnsupportedFileError('Only PDF and Word (.docx or .doc) files are supported.');
  }
  if (ext === '.doc') {
    if (!isOle) throw new UnsupportedFileError('This file is named .doc but is not an old-style Word document.');
    return 'doc';
  }
  if (ext === '.pdf') {
    if (!head.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new UnsupportedFileError('This file is named .pdf but is not a PDF.');
    return 'pdf';
  }
  if (!head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    throw new UnsupportedFileError('This file is named .docx but is not a Word document.');
  }
  return 'docx';
}

export function extract(kind: FileKind, bytes: Uint8Array): Promise<ExtractionResult> {
  return kind === 'pdf' ? extractPdf(bytes) : kind === 'doc' ? extractDoc(bytes) : extractDocx(bytes);
}
