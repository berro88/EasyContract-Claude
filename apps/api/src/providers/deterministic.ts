import type { BlockNote } from '@easycontract/shared';
import type { AiProvider } from '../interfaces/index.ts';
import { detectFlags } from '../extraction/common.ts';

/**
 * Template- and rule-based provider. No network, no keys, no model. It only
 * describes what is observably in the block and where it is; it never reads
 * the text as instructions and never states anything the text doesn't.
 */
export class DeterministicProvider implements AiProvider {
  readonly key = 'deterministic';
  readonly external = false;

  async describeBlock(input: Parameters<AiProvider['describeBlock']>[0]): Promise<BlockNote> {
    const { blockId, kind, clauseNumber, text, level, location } = input;
    const lines: string[] = [];
    const words = text.split(/\s+/).filter(Boolean).length;

    const what =
      kind === 'heading' ? 'a heading'
      : kind === 'table_cell' ? 'text from a table'
      : kind === 'tracked_insertion' ? 'text someone added as a tracked change'
      : kind === 'tracked_deletion' ? 'text someone deleted as a tracked change'
      : 'a paragraph';

    if (level === 'plain') {
      lines.push(clauseNumber ? `This is ${what} in clause ${clauseNumber}.` : `This is ${what}. Clause number: not stated.`);
      lines.push(`Where: ${location}.`);
    } else {
      lines.push(`Kind: ${kind.replace('_', ' ')}.`);
      lines.push(`Clause reference: ${clauseNumber ?? 'not stated'}.`);
      lines.push(`Location: ${location}.`);
      lines.push(`Length: ${words} word${words === 1 ? '' : 's'}.`);
    }

    if (kind === 'tracked_insertion' || kind === 'tracked_deletion') {
      lines.push(
        level === 'plain'
          ? 'Tracked changes may not be agreed yet. Check whether this change was accepted before relying on it.'
          : 'Unaccepted revision. Its status as agreed wording is not stated in the document; confirm acceptance before relying on it.',
      );
    }

    if (detectFlags(text).includes('embedded_instruction')) {
      lines.push(
        'Warning: this passage contains wording that looks like an instruction to software. EasyContract treated it as ordinary document text and did not act on it. Ask why it is in the contract.',
      );
    }

    lines.push('A plain-English explanation of what this clause means is not available yet.');
    return { sourceBlockId: blockId, level, lines };
  }
}
