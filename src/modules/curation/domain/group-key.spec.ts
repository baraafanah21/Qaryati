import { ValidationError } from '../../../shared/kernel';
import { buildGroupKey } from './group-key';
import { CLAIM_GROUP_PREFIXES, CLAIM_TYPES } from './claim-values';

describe('buildGroupKey', () => {
  const villageId = 'village-123';

  it.each(CLAIM_TYPES)('uses the correct prefix for %s', (claimType) => {
    expect(buildGroupKey(claimType, villageId)).toBe(
      `${CLAIM_GROUP_PREFIXES[claimType]}|${villageId}`,
    );
  });

  it('includes additional grouping parts in order', () => {
    expect(buildGroupKey('POPULATION', villageId, '2020', 'male')).toBe(
      'population|village-123|2020|male',
    );
  });

  it.each(['', ' ', '   '])('rejects an empty grouping part %j', (part) => {
    expect(() => buildGroupKey('POPULATION', villageId, part)).toThrow(ValidationError);
  });

  it('rejects a part containing the pipe separator', () => {
    expect(() => buildGroupKey('VILLAGE_NAME', villageId, 'arabic|english')).toThrow(
      ValidationError,
    );
  });

  it('rejects an empty village ID', () => {
    expect(() => buildGroupKey('VILLAGE_NAME', '')).toThrow(ValidationError);
  });

  it('rejects a village ID containing a pipe', () => {
    expect(() => buildGroupKey('VILLAGE_NAME', 'village|123')).toThrow(ValidationError);
  });
});
