import { mapPage, pageOffset, toPage } from './page';

describe('toPage', () => {
  it('wraps rows with the page metadata', () => {
    expect(toPage(['a', 'b'], 45, { page: 2, size: 20 })).toEqual({
      content: ['a', 'b'],
      page: { number: 2, size: 20, totalElements: 45, totalPages: 3 },
    });
  });

  it('reports zero pages for an empty result', () => {
    expect(toPage([], 0, { page: 0, size: 20 }).page).toEqual({
      number: 0,
      size: 20,
      totalElements: 0,
      totalPages: 0,
    });
  });

  it('counts an exactly full last page once', () => {
    expect(toPage([], 40, { page: 0, size: 20 }).page.totalPages).toBe(2);
  });

  it('keeps the requested number when it is past the last page', () => {
    expect(toPage([], 5, { page: 9, size: 20 }).page).toMatchObject({ number: 9, totalPages: 1 });
  });
});

describe('pageOffset', () => {
  it.each([
    [{ page: 0, size: 20 }, 0],
    [{ page: 3, size: 25 }, 75],
  ])('%j skips %i rows', (request, offset) => {
    expect(pageOffset(request)).toBe(offset);
  });
});

describe('mapPage', () => {
  it('maps the content and keeps the metadata', () => {
    const page = toPage([1, 2], 2, { page: 0, size: 20 });
    expect(mapPage(page, (n) => n * 10)).toEqual({ content: [10, 20], page: page.page });
  });
});
