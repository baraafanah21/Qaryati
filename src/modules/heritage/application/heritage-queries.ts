import { Inject, Injectable } from '@nestjs/common';
import {
  HERITAGE_FACT_REPOSITORY,
  type HeritageFactRepository,
  type HeritageFactRow,
} from '../domain/heritage-fact.repository';

/** The published heritage of one village, as other modules see it. */
export interface HeritageSections {
  /** The preferred overview; a question has at most one preferred claim. */
  history: HeritageFactRow<'HISTORY_OVERVIEW'> | null;
  /** By start date. */
  events: HeritageFactRow<'HISTORICAL_EVENT'>[];
  /** By name. */
  landmarks: HeritageFactRow<'LANDMARK'>[];
  /** By category, then name. */
  culturalItems: HeritageFactRow<'CULTURAL_ITEM'>[];
}

/**
 * Public read facade of the heritage module (profile, #39). Only preferred
 * (published) claims, so callers never filter by review state. It does not
 * check the village's publication status: the caller decides who sees which
 * village.
 */
@Injectable()
export class HeritageQueries {
  constructor(@Inject(HERITAGE_FACT_REPOSITORY) private readonly facts: HeritageFactRepository) {}

  /** The four published sections of one village: four indexed statements, run together. */
  async sectionsFor(villageId: string): Promise<HeritageSections> {
    const [history, events, landmarks, culturalItems] = await Promise.all([
      this.facts.preferred('HISTORY_OVERVIEW', villageId),
      this.facts.preferred('HISTORICAL_EVENT', villageId),
      this.facts.preferred('LANDMARK', villageId),
      this.facts.preferred('CULTURAL_ITEM', villageId),
    ]);
    return { history: history[0] ?? null, events, landmarks, culturalItems };
  }
}
