// The usage policy. DRAFT: must be reviewed by a qualified lawyer before any
// real use. Bump the version whenever the wording changes; acceptances are
// recorded against a document key and version.

export const POLICY_KEY = 'usage_policy';
export const POLICY_VERSION = '0.1-draft';
export const POLICY_IS_DRAFT = true;

/** Short form. Shown on every result and every export. Never themed. */
export const POLICY_DISCLAIMER =
  'EasyContract is not a formal legal advisory tool. Consulting a legal practitioner is always advisable.';

export const POLICY_TITLE = 'EasyContract usage policy (draft)';

export const POLICY_SECTIONS: { heading: string; body: string }[] = [
  {
    heading: 'What EasyContract is',
    body:
      'EasyContract helps you read, organise and draft contracts. It points at passages in your documents and describes them in plain language. It is not a formal legal advisory tool and does not create a lawyer-client relationship.',
  },
  {
    heading: 'Always consult a legal practitioner',
    body:
      'Consulting a legal practitioner is always advisable before you sign, send, rely on or change a contract. Nothing EasyContract shows you is legal advice, a legal opinion or a guarantee that a document is complete, valid or enforceable.',
  },
  {
    heading: 'Only what is in your documents',
    body:
      'EasyContract only reports what it finds in the documents you provide. When something is not in the document it says "not stated" rather than guessing. It does not decide which laws apply to you; where it raises a possible legal question, that is a prompt to check, not a conclusion.',
  },
  {
    heading: 'Your responsibility',
    body:
      'You remain responsible for your decisions and for checking every passage against the original document. Automated reading can miss or misread text, especially in scanned or poorly formatted files.',
  },
  {
    heading: 'Your data',
    body:
      'Only upload documents you are entitled to share. Text inside uploaded documents is treated as data and is never followed as an instruction.',
  },
  {
    heading: 'Draft status',
    body:
      'This policy is a draft. It has not yet been reviewed by a lawyer and will change before EasyContract is offered to the public.',
  },
];
