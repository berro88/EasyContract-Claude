import { describe, expect, it } from 'vitest';
import { THEMES } from '@easycontract/shared';
import { allCopy } from './copy.ts';
import { WARNINGS, POLICY_DISCLAIMER } from './warnings.ts';

describe('themes', () => {
  it('every theme defines the same keys', () => {
    const keys = Object.keys(allCopy.normal).sort();
    for (const t of THEMES) expect(Object.keys(allCopy[t]).sort()).toEqual(keys);
  });

  it('themed copy never contains or overrides warnings or the disclaimer', () => {
    const safety = [...Object.values(WARNINGS), POLICY_DISCLAIMER];
    for (const t of THEMES) {
      for (const text of Object.values(allCopy[t])) {
        for (const w of safety) expect(text).not.toContain(w);
        expect(text.toLowerCase()).not.toMatch(/legal advice|disclaimer|warning|risk/);
      }
    }
  });
});
