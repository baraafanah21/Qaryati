import {
  affiliationClaim,
  currentNameLangOf,
  locationClaim,
  measureClaim,
  nameOriginClaim,
  relationClaim,
  villageNameClaim,
} from './fact-claims';
import { validateLocation, validateNameOrigin, validateVillageName } from './village-facts';

const V = '019a0000-0000-7000-8000-0000000000a1';
const OTHER = '019a0000-0000-7000-8000-0000000000a2';
const UNIT = '019a0000-0000-7000-8000-0000000000b1';
const UNIT_2 = '019a0000-0000-7000-8000-0000000000b2';

const name = (fields: Partial<Parameters<typeof validateVillageName>[0]>) =>
  validateVillageName({ name: 'بيت فوريك', lang: 'ar', nameType: 'CURRENT', ...fields });

describe('villageNameClaim', () => {
  it('asks "the current name in <lang>" for a CURRENT name', () => {
    const claim = villageNameClaim(V, name({}));
    expect(claim.claimType).toBe('VILLAGE_NAME');
    expect(claim.groupKey).toBe(`name|${V}|ar|current`);
    expect(claim.valueHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('asks one question per normalized name for the other types', () => {
    expect(villageNameClaim(V, name({ nameType: 'HISTORICAL', name: 'Fūrīk' })).groupKey).toBe(
      `name|${V}|ar|HISTORICAL|furik`,
    );
  });

  it('gives the same key and hash for spacing, tashkeel and letter variants', () => {
    const plain = villageNameClaim(V, name({ name: 'قلقيلية' }));
    for (const variant of ['  قَلْقِيلِيَة ', 'قلقيليه', 'قلقيــلية']) {
      expect(villageNameClaim(V, name({ name: variant }))).toEqual(plain);
    }
    const historical = villageNameClaim(V, name({ nameType: 'HISTORICAL', name: 'إذنا' }));
    expect(villageNameClaim(V, name({ nameType: 'HISTORICAL', name: ' اذنا  ' }))).toEqual(
      historical,
    );
  });

  it('changes the hash with the name or the period, and the key with the language', () => {
    const base = villageNameClaim(V, name({ nameType: 'HISTORICAL', periodFromYear: 1596 }));
    expect(
      villageNameClaim(V, name({ nameType: 'HISTORICAL', periodFromYear: 1597 })).valueHash,
    ).not.toBe(base.valueHash);
    expect(villageNameClaim(V, name({ name: 'بيتا' })).valueHash).not.toBe(
      villageNameClaim(V, name({})).valueHash,
    );
    expect(villageNameClaim(V, name({ lang: 'en', name: 'Beit Furik' })).groupKey).toBe(
      `name|${V}|en|current`,
    );
  });
});

describe('nameOriginClaim', () => {
  it('asks one question per village and ignores spacing in the text', () => {
    const a = nameOriginClaim(
      V,
      validateNameOrigin({ meaning: 'the  well', explanation: 'From  Aramaic' }),
    );
    const b = nameOriginClaim(
      V,
      validateNameOrigin({ meaning: ' the well ', explanation: 'from aramaic' }),
    );
    expect(a).toEqual(b);
    expect(a.groupKey).toBe(`origin|${V}`);
    expect(nameOriginClaim(V, validateNameOrigin({ meaning: 'the spring' })).valueHash).not.toBe(
      a.valueHash,
    );
  });
});

describe('affiliationClaim', () => {
  const value = {
    adminUnitId: UNIT,
    validFrom: null,
    validTo: null,
    unitType: 'GOVERNORATE',
    era: 'CURRENT',
  } as const;

  it('asks "which <unit type> in <era>" and hashes the unit and the dates', () => {
    const claim = affiliationClaim(V, value);
    expect(claim.groupKey).toBe(`affiliation|${V}|GOVERNORATE|CURRENT`);
    expect(affiliationClaim(V, { ...value, adminUnitId: UNIT_2 }).groupKey).toBe(claim.groupKey);
    expect(affiliationClaim(V, { ...value, adminUnitId: UNIT_2 }).valueHash).not.toBe(
      claim.valueHash,
    );
    expect(affiliationClaim(V, { ...value, validFrom: '1995-01-01' }).valueHash).not.toBe(
      claim.valueHash,
    );
    expect(affiliationClaim(V, { ...value, era: 'BRITISH_MANDATE' }).groupKey).toBe(
      `affiliation|${V}|GOVERNORATE|BRITISH_MANDATE`,
    );
  });
});

describe('locationClaim', () => {
  it('hashes the rounded point, so sub-metre noise is the same value', () => {
    const a = locationClaim(
      V,
      validateLocation({ latitude: 32.1234561, longitude: 35.2, precision: 'EXACT' }),
    );
    const b = locationClaim(
      V,
      validateLocation({ latitude: 32.1234649, longitude: 35.2, precision: 'EXACT' }),
    );
    expect(a).toEqual(b);
    expect(a.groupKey).toBe(`location|${V}`);
    const approximate = locationClaim(
      V,
      validateLocation({ latitude: 32.1234561, longitude: 35.2, precision: 'APPROXIMATE' }),
    );
    expect(approximate.valueHash).not.toBe(a.valueHash);
  });
});

describe('measureClaim and relationClaim', () => {
  it('asks one question per measure kind', () => {
    expect(measureClaim(V, { kind: 'ELEVATION_M', value: 520 }).groupKey).toBe(
      `measure|${V}|ELEVATION_M`,
    );
    expect(measureClaim(V, { kind: 'ELEVATION_M', value: 520 }).valueHash).toBe(
      measureClaim(V, { kind: 'ELEVATION_M', value: 520.0 }).valueHash,
    );
    expect(measureClaim(V, { kind: 'ELEVATION_M', value: 521 }).valueHash).not.toBe(
      measureClaim(V, { kind: 'ELEVATION_M', value: 520 }).valueHash,
    );
  });

  it('asks "does <type> hold with <village>"', () => {
    const claim = relationClaim(V, { relatedVillageId: OTHER, relationType: 'MERGED_INTO' });
    expect(claim.groupKey).toBe(`relation|${V}|${OTHER}|MERGED_INTO`);
    expect(claim.claimType).toBe('RELATION');
  });
});

describe('currentNameLangOf', () => {
  it('reads the language of a CURRENT name question only', () => {
    expect(currentNameLangOf(`name|${V}|en|current`)).toBe('en');
    expect(currentNameLangOf(`name|${V}|ar|HISTORICAL|furik`)).toBeUndefined();
    expect(currentNameLangOf(`location|${V}`)).toBeUndefined();
  });
});
