/** Supported claim categories and their group-key prefixes. */
export const CLAIM_GROUP_PREFIXES = {
  VILLAGE_NAME: 'name',
  NAME_ORIGIN: 'origin',
  AFFILIATION: 'affiliation',
  LOCATION: 'location',
  MEASURE: 'measure',
  RELATION: 'relation',
  POPULATION: 'population',
  HISTORY_OVERVIEW: 'history',
  HISTORICAL_EVENT: 'event',
  LANDMARK: 'landmark',
  CULTURAL_ITEM: 'culture',
  VILLAGE_PRODUCT: 'product',
  FACILITY: 'facility',
} as const;

export const CLAIM_TYPES = Object.keys(CLAIM_GROUP_PREFIXES) as Array<
  keyof typeof CLAIM_GROUP_PREFIXES
>;

export type ClaimType = keyof typeof CLAIM_GROUP_PREFIXES;

/** Supported claim review states. */
export const CLAIM_STATUSES = [
  'UNVERIFIED',
  'VERIFIED',
  'DISPUTED',
  'REJECTED',
  'WITHDRAWN',
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Claim types that require a source when initially submitted. */
export const SOURCE_REQUIRED_ON_SUBMIT: readonly ClaimType[] = ['POPULATION'];
