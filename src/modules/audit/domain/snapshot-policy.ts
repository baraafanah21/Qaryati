/**
 * Which snapshot fields the audit trail keeps, per entity type. Use cases
 * already pass allow-listed `snapshot()`s; this second list makes the audit
 * module the last gate, so a careless `snapshot()` cannot store more than the
 * trail is meant to hold.
 */
export type SnapshotPolicy = Readonly<Record<string, readonly string[]>>;

/** Injection token of the {@link SnapshotPolicy} the recorder applies. */
export const AUDIT_SNAPSHOT_POLICY = Symbol('AUDIT_SNAPSHOT_POLICY');

/**
 * The allowed fields of every entity type written today. A new entity type
 * (or a new field worth keeping) is added here, in the same PR as the use case
 * that records it; see the audit README, "Snapshot allow-list".
 */
export const SNAPSHOT_POLICY = {
  AdminUnit: ['code', 'parentId', 'unitType', 'authorityType', 'era', 'nameAr', 'nameEn'],
  Claim: [
    'claimType',
    'villageId',
    'groupKey',
    'valueHash',
    'sourceId',
    'sourceLocator',
    'status',
    'isPreferred',
    'supersedesId',
    'reviewedBy',
    'reviewedAt',
    'reviewNote',
  ],
  RefreshToken: ['id', 'userId', 'familyId', 'expiresAt'],
  Source: [
    'sourceType',
    'title',
    'author',
    'publisher',
    'publishedYear',
    'url',
    'isbn',
    'reliability',
    'notes',
  ],
  UserAccount: ['email', 'role', 'status'],
  Village: [
    'slug',
    'settlementStatus',
    'publicationStatus',
    'displayNameAr',
    'displayNameEn',
    'createdBy',
  ],
} as const satisfies SnapshotPolicy;

/** Keys that look like credentials are dropped even when an allow-list names them. */
const SECRET_LOOKING_KEY = /password|token|secret|hash/i;

/** Secret-looking keys that are known not to be secret, per entity type. */
const NOT_SECRET: SnapshotPolicy = {
  // A digest of the claim's value, used to detect duplicates; not a credential.
  Claim: ['valueHash', 'value_hash'],
};

/**
 * Returns the allowed fields of `entityType`.
 *
 * @throws Error when the type has no entry: every write path is tested, so a
 *   missing entry fails a test long before it reaches production.
 */
export function allowedFields(policy: SnapshotPolicy, entityType: string): readonly string[] {
  if (!Object.hasOwn(policy, entityType)) {
    throw new Error(
      `No audit snapshot allow-list for entity type "${entityType}". ` +
        'Add it to SNAPSHOT_POLICY in src/modules/audit/domain/snapshot-policy.ts.',
    );
  }
  return policy[entityType] ?? [];
}

/**
 * Keeps only the allowed fields of a snapshot, then drops any key that looks
 * like a credential (`/password|token|secret|hash/i`) unless it is a known
 * non-secret for that entity type (`valueHash` on `Claim`).
 *
 * @returns the filtered copy, or `undefined` when there is no snapshot.
 * @throws Error for an entity type without an allow-list ({@link allowedFields}).
 */
export function applySnapshotPolicy(
  policy: SnapshotPolicy,
  entityType: string,
  snapshot: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const allowed = allowedFields(policy, entityType);
  if (snapshot === undefined) return undefined;
  const notSecret = NOT_SECRET[entityType] ?? [];
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (!allowed.includes(key)) continue;
    if (SECRET_LOOKING_KEY.test(key) && !notSecret.includes(key)) continue;
    kept[key] = value;
  }
  return kept;
}
