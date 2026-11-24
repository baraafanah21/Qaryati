import { buildGroupKey, valueHash, type ClaimType } from '../../curation';
import type { AdminEra, AdminUnitType } from './admin-unit-values';
import { normalizeName } from './name-normalizer';
import type {
  AffiliationValue,
  LocationValue,
  MeasureValue,
  NameOriginValue,
  RelationValue,
  VillageNameValue,
} from './village-facts';

/**
 * The question a fact answers (`groupKey`) and the fingerprint of its value
 * (`valueHash`), exactly as `docs/data-model.md` "Claim types" defines them.
 * One pure function per claim type; values arrive already validated.
 */
export interface FactClaim<T extends ClaimType = ClaimType> {
  claimType: T;
  groupKey: string;
  valueHash: string;
}

/** Text compared by meaning, not by spelling: spaces, tashkeel and letter variants do not count. */
const canonicalText = (text: string | null): string | null =>
  text === null ? null : normalizeName(text);

/**
 * `CURRENT`: `name|v|lang|current`, so a village has one published current
 * name per language. Other types: `name|v|lang|type|normalized`, so each
 * historical name or spelling is its own question. Hash: normalized name + period.
 */
export function villageNameClaim(
  villageId: string,
  value: VillageNameValue,
): FactClaim<'VILLAGE_NAME'> {
  const normalized = normalizeName(value.name);
  const groupKey =
    value.nameType === 'CURRENT'
      ? buildGroupKey('VILLAGE_NAME', villageId, value.lang, 'current')
      : buildGroupKey('VILLAGE_NAME', villageId, value.lang, value.nameType, normalized);
  return {
    claimType: 'VILLAGE_NAME',
    groupKey,
    valueHash: valueHash({
      name: normalized,
      periodFromYear: value.periodFromYear,
      periodToYear: value.periodToYear,
    }),
  };
}

/** `origin|v`: one published origin per village. Hash: the three fields, normalized. */
export function nameOriginClaim(
  villageId: string,
  value: NameOriginValue,
): FactClaim<'NAME_ORIGIN'> {
  return {
    claimType: 'NAME_ORIGIN',
    groupKey: buildGroupKey('NAME_ORIGIN', villageId),
    valueHash: valueHash({
      meaning: canonicalText(value.meaning),
      originLanguage: canonicalText(value.originLanguage),
      explanation: canonicalText(value.explanation),
    }),
  };
}

/**
 * `affiliation|v|unit_type|era`: one published governorate (or sub-district,
 * ...) per era. Hash: the unit and the dates.
 */
export function affiliationClaim(
  villageId: string,
  value: AffiliationValue & { unitType: AdminUnitType; era: AdminEra },
): FactClaim<'AFFILIATION'> {
  return {
    claimType: 'AFFILIATION',
    groupKey: buildGroupKey('AFFILIATION', villageId, value.unitType, value.era),
    valueHash: valueHash({
      adminUnitId: value.adminUnitId,
      validFrom: value.validFrom,
      validTo: value.validTo,
    }),
  };
}

/** `location|v`: one published location per village. Hash: the rounded point and the precision. */
export function locationClaim(villageId: string, value: LocationValue): FactClaim<'LOCATION'> {
  return {
    claimType: 'LOCATION',
    groupKey: buildGroupKey('LOCATION', villageId),
    valueHash: valueHash({
      latitude: value.latitude,
      longitude: value.longitude,
      precision: value.precision,
    }),
  };
}

/** `measure|v|kind`: one published value per kind. Hash: the value. */
export function measureClaim(villageId: string, value: MeasureValue): FactClaim<'MEASURE'> {
  return {
    claimType: 'MEASURE',
    groupKey: buildGroupKey('MEASURE', villageId, value.kind),
    valueHash: valueHash({ value: value.value }),
  };
}

/** `relation|v|related|type`: does this relation hold. Hash: the type. */
export function relationClaim(villageId: string, value: RelationValue): FactClaim<'RELATION'> {
  return {
    claimType: 'RELATION',
    groupKey: buildGroupKey('RELATION', villageId, value.relatedVillageId, value.relationType),
    valueHash: valueHash({ relationType: value.relationType }),
  };
}

/**
 * Reads a `VILLAGE_NAME` question back: the language when it is the
 * `CURRENT` name question (`name|v|lang|current`), otherwise `undefined`.
 */
export function currentNameLangOf(groupKey: string): string | undefined {
  const parts = groupKey.split('|');
  return parts.length === 4 && parts[0] === 'name' && parts[3] === 'current' ? parts[2] : undefined;
}
