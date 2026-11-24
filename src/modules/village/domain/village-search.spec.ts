import {
  isVillageSortField,
  resolveVillageSort,
  VILLAGE_SORT_FIELDS,
  visiblePublicationStatus,
} from './village-search';

describe('village search rules', () => {
  it('knows exactly the four sort fields, case-sensitively', () => {
    expect(VILLAGE_SORT_FIELDS).toEqual(['nameAr', 'nameEn', 'createdAt', 'relevance']);
    expect(isVillageSortField('nameAr')).toBe(true);
    expect(isVillageSortField('namear')).toBe(false);
    expect(isVillageSortField('slug')).toBe(false);
  });

  describe('resolveVillageSort', () => {
    it('keeps the requested sort', () => {
      const sort = [{ field: 'createdAt', direction: 'desc' }] as const;
      expect(resolveVillageSort([...sort], false)).toEqual(sort);
    });

    it('defaults to best match first with q, and to the Arabic name without', () => {
      expect(resolveVillageSort([], true)).toEqual([{ field: 'relevance', direction: 'desc' }]);
      expect(resolveVillageSort([], false)).toEqual([{ field: 'nameAr', direction: 'asc' }]);
    });

    it('drops relevance when there is no q', () => {
      expect(
        resolveVillageSort(
          [
            { field: 'relevance', direction: 'desc' },
            { field: 'nameEn', direction: 'asc' },
          ],
          false,
        ),
      ).toEqual([{ field: 'nameEn', direction: 'asc' }]);
      expect(resolveVillageSort([{ field: 'relevance', direction: 'asc' }], false)).toEqual([
        { field: 'nameAr', direction: 'asc' },
      ]);
    });
  });

  describe('visiblePublicationStatus', () => {
    it('limits readers below editor to published villages, whatever they ask', () => {
      expect(visiblePublicationStatus(false, undefined)).toBe('PUBLISHED');
      expect(visiblePublicationStatus(false, 'DRAFT')).toBe('PUBLISHED');
    });

    it('lets editors see every status or filter by one', () => {
      expect(visiblePublicationStatus(true, undefined)).toBeUndefined();
      expect(visiblePublicationStatus(true, 'DRAFT')).toBe('DRAFT');
    });
  });
});
