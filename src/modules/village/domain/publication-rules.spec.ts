import { BusinessRuleViolationError } from '../../../shared/kernel';
import { nextPublicationStatus } from './publication-rules';

describe('nextPublicationStatus', () => {
  it.each([
    ['DRAFT', 'publish', 'PUBLISHED'],
    ['ARCHIVED', 'publish', 'PUBLISHED'],
    ['PUBLISHED', 'archive', 'ARCHIVED'],
  ] as const)('%s + %s -> %s', (from, action, to) => {
    expect(nextPublicationStatus(from, action)).toBe(to);
  });

  it.each([
    ['PUBLISHED', 'publish'],
    ['DRAFT', 'archive'],
    ['ARCHIVED', 'archive'],
  ] as const)('rejects %s + %s with a 422 business rule error', (from, action) => {
    expect(() => nextPublicationStatus(from, action)).toThrow(BusinessRuleViolationError);
  });
});
