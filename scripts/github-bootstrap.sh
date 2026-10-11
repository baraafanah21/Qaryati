#!/usr/bin/env bash
#
# github-bootstrap.sh: configure the Qaryati GitHub repository (issue #1).
#
# Steps, in order:
#   settings    squash merge only, delete head branches, squash title = PR title
#   labels      remove GitHub's default labels, create the module/type labels
#   milestones  every milestone in docs/plan/issues.json (G0..G5, UI)
#   issues      the planned issues, in file order, each number checked
#   project     "Qaryati" board linked to the repo, Status options, all issues added
#   protection  branch protection on main
#   close       comment on #1 with what was configured, then close it
#
# Every step reads the current state first and changes only what differs, so
# running the script again is safe. Issue numbers are checked before and after
# each create: if the next GitHub number does not match the plan, the script
# stops without creating anything else.
#
# Usage:
#   scripts/github-bootstrap.sh [--dry-run] [--only STEP] [--repo OWNER/REPO]
#
#   --dry-run   read the current state, print every write command, change nothing
#   --only      run one step (see the list above)
#   --repo      target repository (default: baraafanah21/Qaryati)
#
# Requires gh (logged in with scopes repo, workflow, project) and jq.
# Push the bootstrap commit to main before running: branch protection is
# enforced for admins, so direct pushes are rejected afterwards.

set -euo pipefail

REPO="baraafanah21/Qaryati"
PLAN="docs/plan/issues.json"
PROJECT_TITLE="Qaryati"
BOOTSTRAP_COMMIT_SUBJECT="chore: bootstrap repository (#1)"
DRY_RUN=false
ONLY=""
STEPS=(settings labels milestones issues project protection close)

# assignee_role in the plan -> GitHub handle. Issues with the role
# "unassigned" are created without an assignee.
UNASSIGNED_ROLE="unassigned"
declare -A HANDLES=(
  [baraa]="baraafanah21"
  [hamam]="hamamalkhateeb2005-commits"
  [momen]="momenaydi"
  [yahya]="yahya-ka"
  [ali]="AliKhalilDev"
)

# "name|colour|description". One colour family per group:
# blue for modules, green for work types, red for blocker.
LABELS=(
  "module:platform|0b3d91|Cross-cutting technical code: src/platform and src/shared"
  "module:iam|1d4ed8|Identity and access: users, tokens, roles"
  "module:village|2563eb|Villages, names, administrative units, search, location"
  "module:curation|3b82f6|Sources, claims and the verification workflow"
  "module:population|60a5fa|Population records and statistics"
  "module:audit|1e40af|Audit trail of every write"
  "module:heritage|93c5fd|History, events, landmarks and cultural items"
  "module:economy|0369a1|Products and facilities"
  "module:geo|0ea5e9|Geocoding integration"
  "module:profile|075985|Read-only village details page, completeness and details cache"
  "module:web|38bdf8|Internal web client in web/ (not graded)"
  "type:feature|0e8a16|New behaviour visible to API users"
  "type:chore|15803d|Tooling, configuration and maintenance"
  "type:test|22c55e|Tests only"
  "type:docs|4ade80|Documentation and ADRs"
  "type:perf|166534|Performance work and load tests"
  "type:security|86efac|Security hardening and review"
  "blocker|b60205|Blocks other work; handle first"
)

DEFAULT_LABELS=("bug" "documentation" "duplicate" "enhancement" "good first issue"
  "help wanted" "invalid" "question" "wontfix")

STATUS_OPTIONS=("Backlog" "Ready" "In progress" "In review" "Done")
READY_ISSUES=" 2 3 4 5 6 7 8 "

# Replaces the default Status options (Todo, In Progress, Done) of a new project.
# GraphQL colour names: GRAY BLUE GREEN YELLOW ORANGE RED PINK PURPLE.
STATUS_MUTATION='mutation($field: ID!) {
  updateProjectV2Field(input: {
    fieldId: $field
    singleSelectOptions: [
      {name: "Backlog",     color: GRAY,   description: "Planned; dependencies not finished yet"}
      {name: "Ready",       color: BLUE,   description: "Dependencies met; can be started"}
      {name: "In progress", color: YELLOW, description: "A branch exists and work is ongoing"}
      {name: "In review",   color: PURPLE, description: "Pull request open and waiting for review"}
      {name: "Done",        color: GREEN,  description: "Merged to main and issue closed"}
    ]
  }) { projectV2Field { ... on ProjectV2SingleSelectField { id } } }
}'

# Filled by step_project and reused by step_close.
PROJECT_NUMBER=""
PROJECT_ID=""
STATUS_FIELD_ID=""
STATUS_NAMES="[]"
declare -A STATUS_OPTION_IDS=()
declare -A ITEM_IDS=()

MANUAL=()

log()  { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '    WARNING: %s\n' "$*" >&2; MANUAL+=("$*"); }
die()  { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

usage() { sed -n '2,/^$/s/^# \{0,1\}//p' "$0"; }

# Runs a command that changes GitHub, or only prints it in dry-run mode.
# Read-only calls bypass run() so a dry run still shows what would change.
run() {
  if $DRY_RUN; then
    printf '    [dry-run]'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

json_array() { jq -R . | jq -sc .; }

# ---------------------------------------------------------------------------

preflight() {
  log "Preflight"
  command -v gh >/dev/null || die "gh is not installed"
  command -v jq >/dev/null || die "jq is not installed"
  [[ -f $PLAN ]] || die "$PLAN not found"

  jq -e '(.issues | length) > 0 and ([.issues[].number] == [range(1; (.issues | length) + 1)])' \
    "$PLAN" >/dev/null || die "$PLAN must list issues numbered 1..N in order"

  local role
  for role in $(jq -r '[.issues[].assignee_role] | unique | .[]' "$PLAN"); do
    [[ $role == "$UNASSIGNED_ROLE" || -n ${HANDLES[$role]:-} ]] \
      || die "no GitHub handle for assignee_role '$role'"
  done

  local defined unknown
  defined=$(printf '%s\n' "${LABELS[@]}" | cut -d'|' -f1 | json_array)
  unknown=$(jq -r --argjson d "$defined" '[.issues[].labels[]] | unique - $d | join(", ")' "$PLAN")
  [[ -z $unknown ]] || die "the plan uses labels this script does not define: $unknown"

  gh auth status >/dev/null 2>&1 || die "gh is not logged in: run gh auth login"
  local scopes s
  scopes=$(gh auth status 2>&1 | grep -i 'token scopes' || true)
  if [[ -n $scopes ]]; then
    for s in repo workflow project; do
      grep -q "'$s'" <<<"$scopes" || die "token lacks scope '$s': run gh auth refresh -s repo,workflow,project"
    done
  else
    info "could not read token scopes; continuing"
  fi

  [[ $(gh api "repos/$REPO" --jq .permissions.admin) == true ]] || die "you are not an admin of $REPO"
  info "repo $REPO, admin access, plan with $(jq '.issues | length' "$PLAN") issues"
  $DRY_RUN && info "DRY RUN: nothing will be changed"
  return 0
}

step_settings() {
  log "Repository settings"
  local current wanted
  current=$(gh api "repos/$REPO" --jq '[.allow_squash_merge, .allow_merge_commit, .allow_rebase_merge,
    .delete_branch_on_merge, .squash_merge_commit_title, .squash_merge_commit_message] | map(tostring) | join(" ")')
  wanted="true false false true PR_TITLE PR_BODY"
  if [[ $current == "$wanted" ]]; then
    info "up to date"
    return
  fi
  run gh api -X PATCH "repos/$REPO" --silent \
    -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
    -F delete_branch_on_merge=true \
    -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY
}

step_labels() {
  log "Labels"
  local existing name colour desc current entry
  existing=$(gh api "repos/$REPO/labels?per_page=100" --paginate \
    --jq '.[] | {name, color, description}' | jq -s 'map({(.name): .}) | add // {}')

  for name in "${DEFAULT_LABELS[@]}"; do
    if jq -e --arg n "$name" 'has($n)' <<<"$existing" >/dev/null; then
      run gh label delete "$name" --repo "$REPO" --yes
    fi
  done

  for entry in "${LABELS[@]}"; do
    IFS='|' read -r name colour desc <<<"$entry"
    current=$(jq -r --arg n "$name" '.[$n] // empty | "\(.color)|\(.description // "")"' <<<"$existing")
    if [[ $current == "$colour|$desc" ]]; then
      info "$name: up to date"
    else
      run gh label create "$name" --repo "$REPO" --color "$colour" --description "$desc" --force
    fi
  done
}

milestones_json() {
  gh api "repos/$REPO/milestones?state=all&per_page=100" --paginate \
    --jq '.[] | {number, title, description, due_on}' | jq -s 'map({(.title): .}) | add // {}'
}

step_milestones() {
  log "Milestones"
  local existing count i title desc due current
  existing=$(milestones_json)
  count=$(jq '.milestones | length' "$PLAN")
  for ((i = 0; i < count; i++)); do
    title=$(jq -r ".milestones[$i].title" "$PLAN")
    desc=$(jq -r ".milestones[$i].description" "$PLAN")
    due=$(jq -r ".milestones[$i].due_on" "$PLAN")
    current=$(jq -c --arg t "$title" '.[$t] // empty' <<<"$existing")
    if [[ -z $current ]]; then
      run gh api "repos/$REPO/milestones" --silent -f title="$title" -f description="$desc" -f due_on="$due"
    elif [[ $(jq -r '.description // ""' <<<"$current") != "$desc" ]]; then
      # GitHub stores due dates at day precision and may shift the time of
      # day, so only the description is compared to keep re-runs quiet.
      run gh api -X PATCH "repos/$REPO/milestones/$(jq -r .number <<<"$current")" --silent \
        -f description="$desc" -f due_on="$due"
    else
      info "$title: up to date (due $(jq -r .due_on <<<"$current"))"
    fi
  done
}

step_issues() {
  log "Issues"
  local milestones existing last count i issue n title handle ms current
  local ms_number assignees payload got missing_labels role
  local -A assignable=()

  milestones=$(milestones_json)
  # The issues endpoint also returns pull requests; both share one number sequence.
  existing=$(gh api "repos/$REPO/issues?state=all&per_page=100" --paginate \
    --jq '.[] | {number, title, pr: (.pull_request != null), labels: [.labels[].name],
                 milestone: (.milestone.title // ""), assignees: [.assignees[].login]}' \
    | jq -s 'map({(.number | tostring): .}) | add // {}')
  last=$(jq '[.[].number] | max // 0' <<<"$existing")

  for role in "${!HANDLES[@]}"; do
    if gh api "repos/$REPO/assignees/${HANDLES[$role]}" --silent 2>/dev/null; then
      assignable[${HANDLES[$role]}]=1
    else
      warn "@${HANDLES[$role]} cannot be assigned yet (invitation not accepted?). Their issues stay unassigned; run again with --only issues after they accept."
    fi
  done

  count=$(jq '.issues | length' "$PLAN")
  for ((i = 0; i < count; i++)); do
    issue=$(jq -c ".issues[$i]" "$PLAN")
    n=$(jq -r .number <<<"$issue")
    title=$(jq -r .title <<<"$issue")
    # Empty for the "unassigned" role (checked in preflight).
    handle=${HANDLES[$(jq -r .assignee_role <<<"$issue")]:-}
    ms=$(jq -r .milestone <<<"$issue")
    current=$(jq -c --arg n "$n" '.[$n] // empty' <<<"$existing")

    if [[ -n $current ]]; then
      [[ $(jq -r .pr <<<"$current") == false ]] \
        || die "#$n is a pull request, but the plan expects issue '$title'. Numbers have drifted."
      [[ $(jq -r .title <<<"$current") == "$title" ]] \
        || die "#$n is '$(jq -r .title <<<"$current")', but the plan expects '$title'. Numbers have drifted."

      # Existing issue: add only what is missing, never remove anything.
      local edit=()
      missing_labels=$(jq -r --argjson c "$current" '.labels - $c.labels | join(",")' <<<"$issue")
      [[ -z $missing_labels ]] || edit+=(--add-label "$missing_labels")
      [[ $(jq -r .milestone <<<"$current") == "$ms" ]] || edit+=(--milestone "$ms")
      if [[ -n $handle && -n ${assignable[$handle]:-} ]] \
        && ! jq -e --arg h "$handle" '.assignees | index($h)' <<<"$current" >/dev/null; then
        edit+=(--add-assignee "$handle")
      fi
      if ((${#edit[@]})); then
        run gh issue edit "$n" --repo "$REPO" "${edit[@]}"
      else
        info "#$n exists: up to date"
      fi
      continue
    fi

    ((n == last + 1)) \
      || die "the next GitHub number is #$((last + 1)), but the plan expects #$n ('$title'). Numbers have drifted; nothing was created."

    ms_number=$(jq -r --arg t "$ms" '.[$t].number // empty' <<<"$milestones")
    if [[ -z $ms_number ]]; then
      $DRY_RUN || die "milestone $ms does not exist; run the milestones step first"
      ms_number=null
    fi
    assignees='[]'
    if [[ -n $handle && -n ${assignable[$handle]:-} ]]; then
      assignees=$(jq -nc --arg h "$handle" '[$h]')
    fi
    payload=$(jq -c --argjson ms "$ms_number" --argjson as "$assignees" \
      '{title, body, labels, milestone: $ms, assignees: $as}' <<<"$issue")

    if $DRY_RUN; then
      info "[dry-run] gh api repos/$REPO/issues --input -  # #$n '$title' ($ms, $(jq -r '.labels | join(",")' <<<"$issue"), ${handle:+@}${handle:-unassigned})"
      last=$n
      continue
    fi

    got=$(gh api "repos/$REPO/issues" --input - --jq .number <<<"$payload")
    [[ $got == "$n" ]] || die "GitHub created #$got for plan issue #$n ('$title'). Numbers have drifted; stopping."
    info "created #$n $title"
    last=$n
    # Stay below GitHub's secondary rate limit for content creation.
    sleep 2
  done
}

# Sets STATUS_FIELD_ID, STATUS_OPTION_IDS and STATUS_NAMES (JSON array).
# Called directly, not in $(...), so the globals survive.
load_status_field() {
  local field
  field=$(gh project field-list "$PROJECT_NUMBER" --owner "${REPO%%/*}" --format json \
    --jq '.fields[] | select(.name == "Status")')
  [[ -n $field ]] || die "project #$PROJECT_NUMBER has no Status field"
  STATUS_FIELD_ID=$(jq -r .id <<<"$field")
  STATUS_OPTION_IDS=()
  local name id
  while IFS=$'\t' read -r id name; do
    STATUS_OPTION_IDS[$name]=$id
  done < <(jq -r '.options[] | "\(.id)\t\(.name)"' <<<"$field")
  STATUS_NAMES=$(jq -c '[.options[].name]' <<<"$field")
}

set_status() {
  local n=$1 status=$2
  run gh project item-edit --id "${ITEM_IDS[$n]}" --project-id "$PROJECT_ID" \
    --field-id "$STATUS_FIELD_ID" --single-select-option-id "${STATUS_OPTION_IDS[$status]}"
  info "#$n -> $status"
}

step_project() {
  log "Project board"
  local owner=${REPO%%/*} project linked wanted items count n state item status
  project=$(gh project list --owner "$owner" --format json --limit 100 \
    --jq "[.projects[] | select(.title == \"$PROJECT_TITLE\")][0] // empty")
  if [[ -z $project ]]; then
    if $DRY_RUN; then
      run gh project create --owner "$owner" --title "$PROJECT_TITLE"
      info "[dry-run] then: link it to $REPO, set Status options, add every issue (Backlog; #2-#8 Ready)"
      return
    fi
    project=$(gh project create --owner "$owner" --title "$PROJECT_TITLE" --format json)
    info "created project #$(jq -r .number <<<"$project")"
  fi
  PROJECT_NUMBER=$(jq -r .number <<<"$project")
  PROJECT_ID=$(jq -r .id <<<"$project")

  linked=$(gh api graphql -f owner="$owner" -f name="${REPO#*/}" \
    -f query='query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) { projectsV2(first: 50) { nodes { number } } } }' \
    --jq '.data.repository.projectsV2.nodes[].number')
  if grep -qx "$PROJECT_NUMBER" <<<"$linked"; then
    info "project #$PROJECT_NUMBER already linked to $REPO"
  else
    run gh project link "$PROJECT_NUMBER" --owner "$owner" --repo "$REPO"
  fi

  load_status_field
  wanted=$(printf '%s\n' "${STATUS_OPTIONS[@]}" | json_array)
  if [[ $STATUS_NAMES != "$wanted" ]]; then
    if $DRY_RUN; then
      run gh api graphql -f field="$STATUS_FIELD_ID" -f query='<STATUS_MUTATION>'
      info "[dry-run] then: add every issue (Backlog; #2-#8 Ready)"
      return
    fi
    if ! gh api graphql -f field="$STATUS_FIELD_ID" -f query="$STATUS_MUTATION" --silent; then
      warn "could not set the Status options through the API. In the project: Settings > Status, make the options exactly: ${STATUS_OPTIONS[*]}. Then run again with --only project."
      return
    fi
    load_status_field
    [[ $STATUS_NAMES == "$wanted" ]] || die "Status options are $STATUS_NAMES after the update, expected $wanted"
    info "Status options set: ${STATUS_OPTIONS[*]}"
  else
    info "Status options up to date"
  fi

  items=$(gh project item-list "$PROJECT_NUMBER" --owner "$owner" --format json --limit 1000 \
    --jq ".items[] | select(.content.type == \"Issue\" and .content.repository == \"$REPO\")
          | {n: .content.number, id, status: (.status // \"\")}" \
    | jq -s 'map({(.n | tostring): .}) | add // {}')

  count=$(jq '.issues | length' "$PLAN")
  for ((n = 1; n <= count; n++)); do
    item=$(jq -r --arg n "$n" '.[$n].id // empty' <<<"$items")
    status=$(jq -r --arg n "$n" '.[$n].status // empty' <<<"$items")
    if [[ -z $item ]]; then
      if $DRY_RUN; then
        run gh project item-add "$PROJECT_NUMBER" --owner "$owner" --url "https://github.com/$REPO/issues/$n"
        continue
      fi
      item=$(gh project item-add "$PROJECT_NUMBER" --owner "$owner" \
        --url "https://github.com/$REPO/issues/$n" --format json --jq .id)
      status=""
    fi
    ITEM_IDS[$n]=$item

    # Keep any status a person has already set; only fill empty ones.
    if [[ -n $status ]]; then
      info "#$n: $status (kept)"
      continue
    fi
    state=$(gh api "repos/$REPO/issues/$n" --jq .state)
    if [[ $state == closed ]]; then
      set_status "$n" "Done"
    elif [[ $READY_ISSUES == *" $n "* ]]; then
      set_status "$n" "Ready"
    else
      set_status "$n" "Backlog"
    fi
  done
}

step_protection() {
  log "Branch protection on main"
  local current checks payload out summary wanted
  # gh prints the error body on 404 ("Branch not protected"), so discard it.
  if ! current=$(gh api "repos/$REPO/branches/main/protection" 2>/dev/null); then
    current=""
  fi

  # Required status checks are added in #4. Keep whatever is already set, so
  # running this script later never removes them.
  checks=$(jq -c '.required_status_checks // null | if . == null then null else {strict, contexts} end' \
    <<<"${current:-null}")

  summary='[.required_pull_request_reviews.required_approving_review_count,
    .required_pull_request_reviews.dismiss_stale_reviews,
    .required_pull_request_reviews.require_code_owner_reviews,
    .enforce_admins.enabled, .required_linear_history.enabled,
    .allow_force_pushes.enabled, .allow_deletions.enabled,
    .required_conversation_resolution.enabled] | map(tostring) | join(" ")'
  wanted="1 true true true true false false true"
  if [[ -n $current && $(jq -r "$summary" <<<"$current") == "$wanted" ]]; then
    info "up to date (required checks: $(jq -r '.contexts // [] | join(", ") | if . == "" then "none" else . end' <<<"$checks"))"
    return
  fi

  payload='{
    "required_status_checks": CHECKS,
    "enforce_admins": true,
    "required_pull_request_reviews": {
      "required_approving_review_count": 1,
      "dismiss_stale_reviews": true,
      "require_code_owner_reviews": true,
      "require_last_push_approval": false
    },
    "restrictions": null,
    "required_linear_history": true,
    "allow_force_pushes": false,
    "allow_deletions": false,
    "required_conversation_resolution": true,
    "block_creations": false,
    "lock_branch": false
  }'
  payload=${payload/CHECKS/$checks}

  if ! gh api "repos/$REPO/contents/.github/CODEOWNERS?ref=main" --silent 2>/dev/null; then
    $DRY_RUN || die ".github/CODEOWNERS is not on main. Push the bootstrap commit first: after this step, direct pushes to main are rejected."
    warn ".github/CODEOWNERS is not on main yet; push the bootstrap commit before the real run"
  fi

  if $DRY_RUN; then
    run gh api -X PUT "repos/$REPO/branches/main/protection" --input -
    info "payload: $(jq -c . <<<"$payload")"
    return
  fi
  if ! out=$(gh api -X PUT "repos/$REPO/branches/main/protection" --input - <<<"$payload" 2>&1); then
    if grep -qiE 'upgrade to github pro|make this repository public' <<<"$out"; then
      die "branch protection on a private repository needs GitHub Pro (free with the GitHub Student Developer Pack) or a public repository. GitHub said: $out"
    fi
    die "branch protection failed: $out"
  fi
  info "applied: PR required, 1 approval, stale approvals dismissed, Code Owner review, conversations resolved, linear history, no force push or deletion, enforced for admins"
}

step_close() {
  log "Close #1"
  local state sha body
  state=$(gh api "repos/$REPO/issues/1" --jq .state 2>/dev/null || echo missing)
  if [[ $state == missing ]] && $DRY_RUN; then
    info "[dry-run] would comment on #1 with the configuration summary and close it"
    return
  fi
  if [[ $state != open ]]; then
    info "#1 is $state; nothing to do"
    return
  fi
  sha=$(gh api "repos/$REPO/commits?sha=main&per_page=100" \
    --jq "[.[] | select(.commit.message | startswith(\"$BOOTSTRAP_COMMIT_SUBJECT\"))][0].sha // empty")
  if [[ -z $sha ]]; then
    warn "no commit '$BOOTSTRAP_COMMIT_SUBJECT' on main; #1 left open"
    return
  fi

  body="Bootstrap done in $sha.

Configured:
- Repository files: README, CONTEXT.md, docs (architecture, workflow, tech stack, ADR template), CODEOWNERS, PR and issue templates, .gitignore, .editorconfig, .nvmrc, .npmrc, docs/plan/issues.json, scripts/github-bootstrap.sh
- Merge settings: squash merge only, squash commit title = PR title, body = PR body, head branches deleted automatically
- Labels: module:*, type:*, blocker (GitHub defaults removed)
- Milestones $(jq -r '[.milestones[].title] | join(", ")' "$PLAN") and issues #1-#$(jq '.issues | length' "$PLAN") from the plan
- Project board \"$PROJECT_TITLE\" with Backlog, Ready, In progress, In review, Done
- Branch protection on main: pull request required, 1 approval, stale approvals dismissed, Code Owner review, conversation resolution, linear history, no force pushes or deletions, enforced for admins. Required status checks are added in #4.

The script is idempotent; see docs/workflow.md."

  run gh issue comment 1 --repo "$REPO" --body "$body"
  run gh issue close 1 --repo "$REPO" --reason completed
  if [[ -n $PROJECT_ID && -n ${ITEM_IDS[1]:-} && -n ${STATUS_OPTION_IDS[Done]:-} ]]; then
    set_status 1 "Done"
  fi
}

# ---------------------------------------------------------------------------

while (($#)); do
  case $1 in
    --dry-run) DRY_RUN=true ;;
    --only) ONLY=${2:-}; shift ;;
    --repo) REPO=${2:-}; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
  shift
done

if [[ -n $ONLY && " ${STEPS[*]} " != *" $ONLY "* ]]; then
  die "unknown step '$ONLY'; expected one of: ${STEPS[*]}"
fi

cd "$(git rev-parse --show-toplevel)"
preflight
for step in "${STEPS[@]}"; do
  if [[ -z $ONLY || $ONLY == "$step" ]]; then
    "step_$step"
  fi
done

log "Finished$($DRY_RUN && echo ' (dry run, nothing changed)')"
if ((${#MANUAL[@]})); then
  printf '\nNeeds attention:\n'
  printf '  - %s\n' "${MANUAL[@]}"
fi
cat <<'EOF'

Check by hand in the project (Settings > Workflows; the API cannot set these):
  - "Item closed" sets Status to Done
  - "Pull request merged" sets Status to Done
EOF
