import { SOURCE_REQUIRED_ON_SUBMIT, valueHash } from '../../curation';
import {
  culturalItemClaim,
  historicalEventClaim,
  historyOverviewClaim,
  landmarkClaim,
} from './heritage-claims';
import type { HistoricalEventValue, LandmarkValue } from './heritage-facts';
import { prepareHeritageFact } from './prepare-heritage-fact';

const VILLAGE = '00000000-0000-7000-8000-000000000001';

describe('sources', () => {
  it('a historical event needs a source: curation enforces it for HISTORICAL_EVENT', () => {
    expect(SOURCE_REQUIRED_ON_SUBMIT).toContain('HISTORICAL_EVENT');
    for (const type of ['HISTORY_OVERVIEW', 'LANDMARK', 'CULTURAL_ITEM'] as const) {
      expect(SOURCE_REQUIRED_ON_SUBMIT).not.toContain(type);
    }
  });
});

describe('historyOverviewClaim', () => {
  it('asks history|v and hashes the summary', () => {
    expect(historyOverviewClaim(VILLAGE, { summary: 'Founded long ago.' })).toEqual({
      claimType: 'HISTORY_OVERVIEW',
      groupKey: `history|${VILLAGE}`,
      valueHash: valueHash({ summary: 'Founded long ago.' }),
    });
  });

  it('treats two texts that differ only in spacing as the same value', () => {
    const a = prepareHeritageFact('HISTORY_OVERVIEW', VILLAGE, { summary: 'a  b' }, '2026-01-01');
    const b = prepareHeritageFact('HISTORY_OVERVIEW', VILLAGE, { summary: ' a b ' }, '2026-01-01');
    expect(a.claim).toEqual(b.claim);
  });
});

describe('historicalEventClaim', () => {
  const event: HistoricalEventValue = {
    title: 'The Great Flood',
    description: 'The wadi flooded.',
    startDate: '1948-01-01',
    endDate: null,
    datePrecision: 'YEAR',
  };

  it('asks event|v|normalized title and hashes dates, precision and description', () => {
    expect(historicalEventClaim(VILLAGE, event)).toEqual({
      claimType: 'HISTORICAL_EVENT',
      groupKey: `event|${VILLAGE}|the great flood`,
      valueHash: valueHash({
        startDate: '1948-01-01',
        endDate: null,
        datePrecision: 'YEAR',
        description: 'The wadi flooded.',
      }),
    });
  });

  it('another date for the same event is the same question with another value', () => {
    const a = historicalEventClaim(VILLAGE, event);
    const b = historicalEventClaim(VILLAGE, {
      ...event,
      title: 'the  great FLOOD',
      startDate: '1949-01-01',
    });
    expect(b.groupKey).toBe(a.groupKey);
    expect(b.valueHash).not.toBe(a.valueHash);
  });

  it('keeps the key separator out of the key', () => {
    expect(historicalEventClaim(VILLAGE, { ...event, title: 'War | Peace' }).groupKey).toBe(
      `event|${VILLAGE}|war / peace`,
    );
  });
});

describe('landmarkClaim', () => {
  const landmark: LandmarkValue = {
    name: 'Al-Masjid al-Qadim',
    landmarkType: 'MOSQUE',
    description: null,
    location: { latitude: 32.1, longitude: 35.2 },
    era: 'OTTOMAN',
  };

  it('asks landmark|v|normalized name and hashes type, point and description', () => {
    expect(landmarkClaim(VILLAGE, landmark)).toEqual({
      claimType: 'LANDMARK',
      groupKey: `landmark|${VILLAGE}|al masjid al qadim`,
      valueHash: valueHash({
        landmarkType: 'MOSQUE',
        location: { latitude: 32.1, longitude: 35.2 },
        description: null,
      }),
    });
  });

  it('points equal after rounding are the same value; another point is not', () => {
    const rounded = (latitude: number) =>
      prepareHeritageFact(
        'LANDMARK',
        VILLAGE,
        { name: 'Well', landmarkType: 'WELL', location: { latitude, longitude: 35 } },
        '2026-01-01',
      ).claim.valueHash;
    expect(rounded(32.123451)).toBe(rounded(32.123449));
    expect(rounded(32.1235)).not.toBe(rounded(32.1234));
  });
});

describe('culturalItemClaim', () => {
  it('asks culture|v|category|normalized name and hashes the description', () => {
    expect(
      culturalItemClaim(VILLAGE, { category: 'DISH', name: 'Musakhan', description: 'Bread.' }),
    ).toEqual({
      claimType: 'CULTURAL_ITEM',
      groupKey: `culture|${VILLAGE}|DISH|musakhan`,
      valueHash: valueHash({ description: 'Bread.' }),
    });
  });

  it('the same name in another category is another question', () => {
    const song = culturalItemClaim(VILLAGE, {
      category: 'FOLK_SONG',
      name: 'Dalouna',
      description: 'x',
    });
    const dance = culturalItemClaim(VILLAGE, {
      category: 'DANCE',
      name: 'Dalouna',
      description: 'x',
    });
    expect(song.groupKey).not.toBe(dance.groupKey);
  });
});
