// Tone of voice per theme. Only friendly, non-safety wording lives here.
// Warnings and the disclaimer live in warnings.ts and are the same in every theme.

import type { Theme } from '@easycontract/shared';

const COPY = {
  fun: {
    homeTitle: "Contracts, minus the headache",
    homeLead: 'Pick what you want to do. We will walk you through it, one friendly step at a time.',
    understandTitle: 'Understand a contract',
    understandBody: 'Upload a contract and see it laid out clearly, clause by clause.',
    createTitle: 'Create a contract',
    createBody: 'Answer simple questions and get a solid first draft.',
    comingSoon: "We're still building this one. Hang tight!",
    newProject: 'Start a new project',
    noProjects: 'No projects yet. Start one and drop in your first contract.',
    uploadHint: 'Drop a PDF or Word file here, or click to choose one.',
    profileSaved: 'Saved! Nice.',
  },
  normal: {
    homeTitle: 'What would you like to do?',
    homeLead: 'Choose an option to get started.',
    understandTitle: 'Understand a contract',
    understandBody: 'Upload a contract and read it clause by clause, with each passage linked to its source.',
    createTitle: 'Create a contract',
    createBody: 'Build a contract by answering plain-English questions.',
    comingSoon: 'This feature is coming soon.',
    newProject: 'New project',
    noProjects: 'You have no projects yet. Create one to upload documents.',
    uploadHint: 'Drag a PDF or Word file here, or click to choose.',
    profileSaved: 'Profile saved.',
  },
  professional: {
    homeTitle: 'Contract workspace',
    homeLead: 'Select a workflow.',
    understandTitle: 'Contract review',
    understandBody: 'Upload agreements and supporting documents for structured, source-linked review.',
    createTitle: 'Contract drafting',
    createBody: 'Assemble a draft agreement from guided questions.',
    comingSoon: 'This workflow is not yet available.',
    newProject: 'New matter',
    noProjects: 'No matters on file. Create a matter to upload documents.',
    uploadHint: 'Drag a PDF, DOCX or DOC file here, or click to select.',
    profileSaved: 'Company profile updated.',
  },
} satisfies Record<Theme, Record<string, string>>;

export type CopyKey = keyof (typeof COPY)['normal'];
export const copy = (theme: Theme, key: CopyKey): string => COPY[theme][key];
export const allCopy = COPY;
