#!/usr/bin/env bash
# Fails when a module's schema.ts differs from what the committed migrations
# produce, i.e. someone changed a table but did not run `npm run db:generate`
# (or edited the generated SQL snapshot by hand).
#
# drizzle-kit generate compares the schema files with migrations/meta and
# writes a new migration only if they differ. So: generate, and if anything
# in migrations/ changed, the committed migrations are out of date.
#
# Usage: npm run db:drift   (CI runs it in the quality job; see docs/ci.md)
# Locally, a failure leaves the generated migration in migrations/ so you can
# review and commit it.
set -euo pipefail

cd "$(dirname "$0")/.."

# stdin from /dev/null: if drizzle-kit needs to ask (e.g. "was this column
# renamed?"), it fails instead of waiting for input forever.
npx drizzle-kit generate </dev/null

changes=$(git status --porcelain --untracked-files=all -- migrations)
if [[ -n $changes ]]; then
  echo
  echo "Schema drift: the schema.ts files do not match the committed migrations." >&2
  echo "Run 'npm run db:generate', review the SQL and commit it. Changed files:" >&2
  echo "$changes" >&2
  exit 1
fi
echo "No schema drift: migrations match the schema files."
