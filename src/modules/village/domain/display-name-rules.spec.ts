import { canEditDisplayName } from './display-name-rules';

describe('canEditDisplayName', () => {
  it.each(['ar', 'en'] as const)('allows editing %s while no CURRENT name is published', (lang) => {
    expect(canEditDisplayName(lang, false)).toBe(true);
  });

  it.each(['ar', 'en'] as const)('locks %s once a CURRENT name is published', (lang) => {
    expect(canEditDisplayName(lang, true)).toBe(false);
  });
});
