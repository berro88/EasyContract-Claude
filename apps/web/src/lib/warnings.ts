// Safety wording. Deliberately NOT themed: the Fun theme must never soften these.
export { POLICY_DISCLAIMER } from '@easycontract/shared';

export const WARNINGS = {
  unreadable: "We couldn't read this document.",
  embeddedInstruction:
    'This passage contains wording that looks like an instruction to software. EasyContract treated it as ordinary document text and did not act on it. Ask why it is in the contract.',
  trackedChange: 'Tracked change: this wording may not be agreed yet. Check whether it was accepted before relying on it.',
  unverified: 'The original file no longer matches this passage. Re-upload the document before relying on it.',
  draftPolicy: 'The usage policy is a draft and has not yet been reviewed by a lawyer.',
  fromScan: 'Read from a scan. Automatic reading can get words and numbers wrong: check the wording against the original before relying on it.',
  lowConfidence: 'The scan was hard to read here. Check this wording against the original.',
} as const;
