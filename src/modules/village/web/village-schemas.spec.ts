import { listAdminUnitsQuery } from './admin-unit.schemas';
import { createVillageBody, updateVillageBody } from './village.schemas';

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
