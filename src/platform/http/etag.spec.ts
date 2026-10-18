import { formatETag, parseIfMatch } from './etag';

describe('formatETag', () => {
  it('quotes the version as a strong entity tag', () => {
    expect(formatETag(3)).toBe('"3"');
  });
});

describe('parseIfMatch', () => {
  it.each([
    ['"3"', 3],
    ['"1"', 1],
    [' "42" ', 42],
  ])('reads %s as version %i', (header, version) => {
    expect(parseIfMatch(header)).toEqual({ kind: 'version', version });
  });

  it.each([undefined, ''])('treats %p as missing', (header) => {
    expect(parseIfMatch(header)).toEqual({ kind: 'missing' });
  });

  it.each([
    ['3', 'unquoted'],
    ['W/"3"', 'weak tag'],
    ['*', 'wildcard'],
    ['"1", "2"', 'list'],
    ['"abc"', 'not a number'],
    ['"-1"', 'negative'],
    ['"1.5"', 'fraction'],
    ['"9999999999"', 'too large'],
  ])('rejects %s (%s) as malformed', (header) => {
    expect(parseIfMatch(header)).toEqual({ kind: 'malformed' });
  });

  it('rejects a repeated header as malformed', () => {
    expect(parseIfMatch(['"1"', '"2"'])).toEqual({ kind: 'malformed' });
  });
});
