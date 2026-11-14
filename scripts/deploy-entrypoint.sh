#!/usr/bin/env bash
# Install once as /usr/local/sbin/kvitanator-deploy. The Actions SSH key is
# restricted to this entrypoint in authorized_keys; it cannot open a shell.
set -Eeuo pipefail

readonly project_dir=/opt/bot-tg-kvitanator

if [[ ${SSH_ORIGINAL_COMMAND:-} == check ]]; then
  test -d "$project_dir/.git"
  printf 'Kvitanator deployment access OK\n'
  exit 0
fi

if [[ ! ${SSH_ORIGINAL_COMMAND:-} =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
  printf 'Only "check" and "deploy <commit SHA>" are allowed.\n' >&2
  exit 64
fi
readonly requested_sha=${BASH_REMATCH[1]}

exec 9>/var/lock/kvitanator-deploy.lock
flock --wait 1200 9
cd "$project_dir"

if [[ $(git branch --show-current) != main ]]; then
  printf 'Refusing to deploy: server checkout must be on main.\n' >&2
  exit 1
fi
git diff --quiet
git diff --cached --quiet
git fetch origin main
latest_sha=$(git rev-parse refs/remotes/origin/main)
readonly latest_sha
if [[ $requested_sha != "$latest_sha" ]]; then
  if git merge-base --is-ancestor "$requested_sha" "$latest_sha"; then
    printf 'Skipping superseded commit %s; main is already at %s.\n' "$requested_sha" "$latest_sha"
    exit 0
  fi
  printf 'Requested commit is not in main.\n' >&2
  exit 1
fi

git merge --ff-only "$requested_sha"
test -f scripts/deploy.sh
# fd 9 stays open across exec, holding the server lock for the whole deployment.
exec bash scripts/deploy.sh "$requested_sha"
