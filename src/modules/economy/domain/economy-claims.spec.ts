import { valueHash } from '../../curation';
import { facilityClaim, prepareEconomyFact, villageProductClaim } from './economy-claims';
import type { FacilityValue } from './economy-facts';

const VILLAGE = '00000000-0000-7000-8000-000000000001';
const PRODUCT = '01a20db1-12b4-7421-9ec7-12d928a79af1';
const OTHER_PRODUCT = '01a20db1-12b5-7174-8c9e-163d9074b3c1';

describe('villageProductClaim', () => {
  it('asks product|v|product_id and hashes the significance', () => {
    expect(villageProductClaim(VILLAGE, { productId: PRODUCT, significance: 'PRIMARY' })).toEqual({
      claimType: 'VILLAGE_PRODUCT',
      groupKey: `product|${VILLAGE}|${PRODUCT}`,
      valueHash: valueHash({ significance: 'PRIMARY' }),
    });
  });

  it('another significance is the same question with another value (a conflict)', () => {
    const primary = villageProductClaim(VILLAGE, { productId: PRODUCT, significance: 'PRIMARY' });
    const historical = villageProductClaim(VILLAGE, {
      productId: PRODUCT,
      significance: 'HISTORICAL',
    });
    expect(historical.groupKey).toBe(primary.groupKey);
    expect(historical.valueHash).not.toBe(primary.valueHash);
  });

  it('another product is another question', () => {
    const a = villageProductClaim(VILLAGE, { productId: PRODUCT, significance: 'PRIMARY' });
    const b = villageProductClaim(VILLAGE, { productId: OTHER_PRODUCT, significance: 'PRIMARY' });
    expect(b.groupKey).not.toBe(a.groupKey);
    expect(b.valueHash).toBe(a.valueHash);
  });
});

describe('facilityClaim', () => {
  const school: FacilityValue = {
    facilityType: 'SCHOOL',
    name: 'Al-Quds School',
    location: { latitude: 32.12346, longitude: 35.23457 },
    establishedYear: 1950,
  };

  it('asks facility|v|type|normalized name and hashes the point and the year', () => {
    expect(facilityClaim(VILLAGE, school)).toEqual({
      claimType: 'FACILITY',
      groupKey: `facility|${VILLAGE}|SCHOOL|al quds school`,
      valueHash: valueHash({
        location: { latitude: 32.12346, longitude: 35.23457 },
        establishedYear: 1950,
      }),
    });
  });

  it('spelling variants of a name are the same question', () => {
    const a = facilityClaim(VILLAGE, { ...school, name: 'مدرسة  القرية' });
    const b = facilityClaim(VILLAGE, { ...school, name: 'مَدرسة القريه' });
    expect(b.groupKey).toBe(a.groupKey);
  });

  it('the same name of another type is another question; a | in the name becomes /', () => {
    const clinic = facilityClaim(VILLAGE, { ...school, facilityType: 'CLINIC' });
    expect(clinic.groupKey).not.toBe(facilityClaim(VILLAGE, school).groupKey);
    expect(facilityClaim(VILLAGE, { ...school, name: 'A|B' }).groupKey).toBe(
      `facility|${VILLAGE}|SCHOOL|a/b`,
    );
  });

  it('another year or point is another value; no point and no year hash as nulls', () => {
    const base = facilityClaim(VILLAGE, school).valueHash;
    expect(facilityClaim(VILLAGE, { ...school, establishedYear: 1960 }).valueHash).not.toBe(base);
    expect(facilityClaim(VILLAGE, { ...school, location: null }).valueHash).not.toBe(base);
    expect(
      facilityClaim(VILLAGE, { ...school, location: null, establishedYear: null }).valueHash,
    ).toBe(valueHash({ location: null, establishedYear: null }));
  });
});

describe('prepareEconomyFact', () => {
  it('validates, then builds the claim from the cleaned value', () => {
    const a = prepareEconomyFact(
      'FACILITY',
      VILLAGE,
      {
        facilityType: 'PARK',
        name: ' Central  Park ',
        location: { latitude: 1.000001, longitude: 2 },
      },
      2026,
    );
    const b = prepareEconomyFact(
      'FACILITY',
      VILLAGE,
      { facilityType: 'PARK', name: 'central park', location: { latitude: 1, longitude: 2 } },
      2026,
    );
    expect(a.value.name).toBe('Central Park');
    expect(a.claim).toEqual(b.claim);
  });

  it('builds a village product claim', () => {
    expect(
      prepareEconomyFact(
        'VILLAGE_PRODUCT',
        VILLAGE,
        { productId: PRODUCT, significance: 'SECONDARY' },
        2026,
      ).claim.groupKey,
    ).toBe(`product|${VILLAGE}|${PRODUCT}`);
  });
});
