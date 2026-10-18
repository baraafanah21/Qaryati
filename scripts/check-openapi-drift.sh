#!/usr/bin/env bash
# Fails when docs/api/openapi.json is not what the code generates, i.e. someone
# changed an endpoint, DTO or Swagger decorator but did not run
# `npm run openapi:generate` and commit the result.
#
# The generator needs no database or Redis (src/generate-openapi.ts), so this
# runs in the CI quality job next to the schema drift check (docs/ci.md).
# Locally, a failure leaves the regenerated file in place for you to review
# and commit.
set -euo pipefail

cd "$(dirname "$0")/.."

npm run --silent openapi:generate

changes=$(git status --porcelain --untracked-files=all -- docs/api/openapi.json)
if [[ -n $changes ]]; then
  echo
  echo "OpenAPI drift: docs/api/openapi.json does not match the code." >&2
  echo "Run 'npm run openapi:generate', review the diff and commit it." >&2
  git --no-pager diff --stat -- docs/api/openapi.json >&2 || true
  exit 1
fi
echo "No OpenAPI drift: docs/api/openapi.json matches the code."
