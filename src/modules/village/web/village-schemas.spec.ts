import { listAdminUnitsQuery } from './admin-unit.schemas';
import { createVillageBody, searchVillagesQuery, updateVillageBody } from './village.schemas';

describe('listAdminUnitsQuery', () => {
  it('accepts no filters and every known filter', () => {
    expect(listAdminUnitsQuery.parse({})).toEqual({});
    expect(
      listAdminUnitsQuery.parse({
        type: 'GOVERNORATE',
        era: 'CURRENT',
        parentId: '01a1ef5b-4742-704c-8b62-1016335f1730',
      }),
    ).toEqual({
      type: 'GOVERNORATE',
      era: 'CURRENT',
      parentId: '01a1ef5b-4742-704c-8b62-1016335f1730',
    });
  });

  it.each([{ type: 'governorate' }, { era: 'ROMAN' }, { parentId: 'nablus' }, { sort: 'nameAr' }])(
    'rejects %j',
    (query) => {
      expect(listAdminUnitsQuery.safeParse(query).success).toBe(false);
    },
  );
});

describe('village bodies', () => {
  it('accepts a create body with an optional English name', () => {
    expect(
      createVillageBody.safeParse({
        slug: 'burin',
        settlementStatus: 'INHABITED',
        displayNameAr: 'بورين',
      }).success,
    ).toBe(true);
  });

  it.each([
    { slug: 'burin', settlementStatus: 'UNKNOWN', displayNameAr: 'بورين' },
    { slug: 'burin', settlementStatus: 'INHABITED' },
    { slug: 'burin', settlementStatus: 'INHABITED', displayNameAr: 'بورين', status: 'PUBLISHED' },
  ])('rejects the create body %j', (body) => {
    expect(createVillageBody.safeParse(body).success).toBe(false);
  });

  it('does not let PATCH change the slug or the publication status', () => {
    expect(updateVillageBody.safeParse({ slug: 'other' }).success).toBe(false);
    expect(updateVillageBody.safeParse({ publicationStatus: 'PUBLISHED' }).success).toBe(false);
    expect(updateVillageBody.safeParse({ displayNameEn: null }).success).toBe(true);
  });
});

describe('searchVillagesQuery', () => {
  const ID_A = '01a1ef5b-4742-704c-8b62-1016335f1730';
  const ID_B = '01a1ef5b-4742-704c-8b62-1016335f1731';

  it('defaults to page 0, size 20 and no sort (the use case picks it)', () => {
    expect(searchVillagesQuery.parse({})).toEqual({ page: 0, size: 20, sort: [] });
  });

  it('accepts every filter and parses the id list', () => {
    expect(
      searchVillagesQuery.parse({
        q: '  بيت فوريك ',
        governorate: 'nablus',
        settlementStatus: 'INHABITED',
        publicationStatus: 'DRAFT',
        ids: `${ID_A}, ${ID_B.toUpperCase()}`,
        sort: ['relevance,desc', 'nameEn'],
        page: '2',
        size: '100',
      }),
    ).toEqual({
      q: 'بيت فوريك',
      governorate: 'nablus',
      settlementStatus: 'INHABITED',
      publicationStatus: 'DRAFT',
      ids: [ID_A, ID_B],
      sort: [
        { field: 'relevance', direction: 'desc' },
        { field: 'nameEn', direction: 'asc' },
      ],
      page: 2,
      size: 100,
    });
  });

  it.each(['nameAr', 'nameEn', 'createdAt'])('sorts by %s without q', (field) => {
    expect(searchVillagesQuery.parse({ sort: `${field},desc` }).sort).toEqual([
      { field, direction: 'desc' },
    ]);
  });

  it.each([
    [{ sort: 'slug' }, 'sort'],
    [{ sort: 'nameAr,sideways' }, 'sort'],
    [{ sort: 'relevance' }, 'sort'],
    [{ size: '101' }, 'size'],
    [{ size: '0' }, 'size'],
    [{ q: '   ' }, 'q'],
    [{ q: 'x'.repeat(101) }, 'q'],
    [{ settlementStatus: 'inhabited' }, 'settlementStatus'],
    [{ publicationStatus: 'GONE' }, 'publicationStatus'],
    [{ ids: 'not-a-uuid' }, 'ids'],
    [{ ids: '' }, 'ids'],
    [{ product: 'olives' }, ''],
  ])('rejects %j', (query, field) => {
    const result = searchVillagesQuery.safeParse(query);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path.join('.') ?? '').toMatch(new RegExp(`^${field}`));
  });

  it('caps the id list at 100', () => {
    const ids = (count: number) =>
      Array.from({ length: count }, (_, i) => ID_A.slice(0, -3) + String(i).padStart(3, '0'));
    expect(searchVillagesQuery.safeParse({ ids: ids(100).join(',') }).success).toBe(true);
    const tooMany = searchVillagesQuery.safeParse({ ids: ids(101).join(',') });
    expect(tooMany.success).toBe(false);
    expect(tooMany.error?.issues[0]?.path).toEqual(['ids']);
  });
});
