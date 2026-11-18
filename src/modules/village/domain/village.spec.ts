import {
  BusinessRuleViolationError,
  FixedClock,
  SequentialIdGenerator,
  ValidationError,
} from '../../../shared/kernel';
import { Village } from './village';

const clock = new FixedClock('2026-11-18T08:00:00Z');
const ids = new SequentialIdGenerator();
const CREATOR = '00000000-0000-7000-8000-000000000001';
const OTHER = '00000000-0000-7000-8000-000000000002';
const NONE_PUBLISHED = { ar: false, en: false };

const draft = (overrides: Partial<Parameters<typeof Village.create>[0]> = {}) =>
  Village.create({
    id: ids.next<'Village'>(),
    slug: 'beit-furik',
    settlementStatus: 'INHABITED',
    displayNameAr: ' بيت فوريك ',
    displayNameEn: 'Beit Furik',
    createdBy: CREATOR,
    now: clock.now(),
    ...overrides,
  });

describe('Village', () => {
  describe('create', () => {
    it('starts as a DRAFT at version 1 with trimmed names', () => {
      const village = draft();
      expect(village.publicationStatus).toBe('DRAFT');
      expect(village.version).toBe(1);
      expect(village.displayNameAr).toBe('بيت فوريك');
      expect(village.location).toBeNull();
    });

    it.each(['Beit-Furik', 'beit--furik', '-beit', 'a b', ''])('rejects the slug %j', (slug) => {
      expect(() => draft({ slug })).toThrow(ValidationError);
    });

    it('rejects a UUID-shaped slug, which would make {idOrSlug} ambiguous', () => {
      expect(() => draft({ slug: '01a1ef5b-4742-704c-8b62-1016335f1730' })).toThrow(
        ValidationError,
      );
    });

    it('rejects an unknown settlement status', () => {
      expect(() => draft({ settlementStatus: 'inhabited' })).toThrow(ValidationError);
    });

    it('rejects a blank Arabic name', () => {
      expect(() => draft({ displayNameAr: '   ' })).toThrow(ValidationError);
    });
  });

  describe('visibility and edit rights', () => {
    it('shows a draft only to logged-in users', () => {
      const village = draft();
      expect(village.isVisibleTo(undefined)).toBe(false);
      expect(village.isVisibleTo({ id: OTHER })).toBe(true);
      expect(village.transition('publish').isVisibleTo(undefined)).toBe(true);
    });

    it('lets editors edit any village and the creator only their draft', () => {
      const village = draft();
      expect(village.canBeEditedBy({ id: CREATOR, isEditor: false })).toBe(true);
      expect(village.canBeEditedBy({ id: OTHER, isEditor: false })).toBe(false);
      expect(village.canBeEditedBy({ id: OTHER, isEditor: true })).toBe(true);
      const published = village.transition('publish');
      expect(published.canBeEditedBy({ id: CREATOR, isEditor: false })).toBe(false);
    });
  });

  describe('applyChanges', () => {
    it('changes the settlement status and names while no CURRENT name is published', () => {
      const changed = draft().applyChanges(
        { settlementStatus: 'DEPOPULATED', displayNameAr: 'فوريك', displayNameEn: null },
        NONE_PUBLISHED,
      );
      expect(changed.settlementStatus).toBe('DEPOPULATED');
      expect(changed.displayNameAr).toBe('فوريك');
      expect(changed.displayNameEn).toBeNull();
    });

    it('rejects an Arabic name edit once an Arabic CURRENT name is published', () => {
      expect(() =>
        draft().applyChanges({ displayNameAr: 'فوريك' }, { ar: true, en: false }),
      ).toThrow(BusinessRuleViolationError);
    });

    it('still allows the English name while only the Arabic one is published', () => {
      const changed = draft().applyChanges({ displayNameEn: 'Furik' }, { ar: true, en: false });
      expect(changed.displayNameEn).toBe('Furik');
    });

    it('allows other fields even when both names are published', () => {
      const changed = draft().applyChanges({ settlementStatus: 'MERGED' }, { ar: true, en: true });
      expect(changed.settlementStatus).toBe('MERGED');
    });
  });

  it('snapshot keeps the allow-listed identity fields', () => {
    expect(draft().snapshot()).toEqual({
      slug: 'beit-furik',
      settlementStatus: 'INHABITED',
      publicationStatus: 'DRAFT',
      displayNameAr: 'بيت فوريك',
      displayNameEn: 'Beit Furik',
      createdBy: CREATOR,
    });
  });
});
