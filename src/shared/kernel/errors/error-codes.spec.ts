import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ErrorCode, FieldErrorCode } from './error-codes';

// docs/errors.md is the public catalogue: the `type` URI of every problem
// response points at a section there. A code without a section is a dead link.
const errorsDoc = readFileSync(resolve(__dirname, '../../../../docs/errors.md'), 'utf8');

describe('docs/errors.md', () => {
  it.each(Object.values(ErrorCode))('has an anchored section for %s', (code) => {
    const anchor = code.toLowerCase().replaceAll('_', '-');
    expect(errorsDoc).toContain(`<a id="${anchor}"></a>`);
    expect(errorsDoc).toContain(`### \`${code}\``);
  });

  it.each(Object.values(FieldErrorCode))('lists the field code %s', (code) => {
    expect(errorsDoc).toMatch(new RegExp(`^\\| \`${code}\` +\\|`, 'm'));
  });
});

describe('ErrorCode', () => {
  it('uses each key as its value, in SCREAMING_SNAKE_CASE', () => {
    for (const [key, value] of Object.entries(ErrorCode)) {
      expect(value).toBe(key);
      expect(value).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
    }
  });
});
