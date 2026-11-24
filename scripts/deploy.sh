#!/usr/bin/env bash
# Manual deploy for the Perks VPS. Run ON the server as the `perks` user.
#   bash scripts/deploy.sh <commit-sha>
# The commit is required: the release is exactly the commit that was approved (and checked by
# CI), never whatever the branch tip happens to be when the script runs. It must already be on
# origin/$DEPLOY_BRANCH and be a fast-forward of the current checkout.
# Overridable env: APP_DIR, DEPLOY_USER, DEPLOY_BRANCH, HEALTH_URL, HEALTH_TRIES,
#   WORKER_SERVICE, WORKER_STABLE_SECONDS, WORKER_HEARTBEAT_FILE
set -euo pipefail

# Everything lives in main() and the script exits before the closing line, so
# bash never re-reads a file that the checkout replaced while we are running.
main() {
  local app_dir="${APP_DIR:-/opt/perks}"
  local deploy_user="${DEPLOY_USER:-perks}"
  local branch="${DEPLOY_BRANCH:-master}"
  local health_url="${HEALTH_URL:-http://127.0.0.1:4100/health/ready}"
  local tries="${HEALTH_TRIES:-30}"
  local worker="${WORKER_SERVICE:-perks-worker}"
  local stable="${WORKER_STABLE_SECONDS:-15}"
  # Optional: the worker touches this file about every 10 s. Set it when the deploy user can
  # see the worker's temp directory (no systemd PrivateTmp), e.g. /tmp/nuqta-worker-heartbeat.
  # It must have been touched by the restarted worker, not by the one it replaced.
  local heartbeat="${WORKER_HEARTBEAT_FILE:-}"
  local target="${1:-}"

  if [[ ! "$target" =~ ^[0-9a-f]{40}$ ]]; then
    echo "ERROR: pass the full 40-character commit SHA to deploy (got '${target}')." >&2
    exit 1
  fi

  if [[ "$(id -un)" != "$deploy_user" ]]; then
    echo "ERROR: must run as user '$deploy_user' (currently '$(id -un)')." >&2
    exit 1
  fi

  cd "$app_dir"

  echo "==> Fetching origin/$branch"
  git fetch --prune origin "$branch"

  local current
  current="$(git rev-parse --abbrev-ref HEAD)"
  if [[ "$current" != "$branch" ]]; then
    echo "ERROR: checked out '$current', expected '$branch'." >&2
    exit 1
  fi

  if ! git cat-file -e "${target}^{commit}" 2>/dev/null; then
    echo "ERROR: commit $target is not on origin/$branch." >&2
    exit 1
  fi
  if ! git merge-base --is-ancestor "$target" "origin/$branch"; then
    echo "ERROR: commit $target is not on origin/$branch." >&2
    exit 1
  fi

  echo "==> Commits about to be deployed (HEAD..$target):"
  if [[ -n "$(git log --oneline "HEAD..$target")" ]]; then
    git log --no-decorate --format='%h %an  %s' "HEAD..$target"
  else
    echo "(none - already at this commit)"
  fi

  echo "==> git merge --ff-only $target"
  git merge --ff-only "$target"
  if [[ "$(git rev-parse HEAD)" != "$target" ]]; then
    echo "ERROR: checkout is at $(git rev-parse HEAD), expected $target." >&2
    exit 1
  fi

  echo "==> npm ci"
  npm ci

  echo "==> npm run build"
  npm run build

  echo "==> npm run db:migrate"
  npm run db:migrate

  local restart_at
  restart_at="$(date +%s)"

  echo "==> Restarting services"
  # Must match the sudoers rule exactly (arguments are matched literally).
  sudo systemctl restart perks perks-worker

  echo "==> Health check: $health_url"
  local code="000" i api_ok=0
  for ((i = 1; i <= tries; i++)); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$health_url" || true)"
    if [[ "$code" == "200" ]]; then
      echo "OK: /health/ready returned 200 (attempt $i)."
      api_ok=1
      break
    fi
    echo "  attempt $i/$tries: HTTP $code"
    sleep 2
  done
  if [[ "$api_ok" != 1 ]]; then
    echo "ERROR: health check did not return 200 (last: $code). Check: journalctl -u perks -u $worker -n 100" >&2
    return 1
  fi

  # The API answering says nothing about the worker: mail, exports, notifications and
  # expiry sweeps stall silently when it is down. It must be active, and stay active on the
  # same process (no crash loop) for a while after the restart.
  echo "==> Worker check: $worker (stable for ${stable}s)"
  local state pid restarts restarts_before
  state="$(systemctl is-active "$worker" 2>/dev/null || true)"
  pid="$(systemctl show -p MainPID --value "$worker" 2>/dev/null || echo 0)"
  restarts_before="$(systemctl show -p NRestarts --value "$worker" 2>/dev/null || echo 0)"
  if [[ "$state" != "active" || "$pid" == "0" ]]; then
    echo "ERROR: worker $worker is '$state' after restart. Check: journalctl -u $worker -n 100" >&2
    return 1
  fi
  sleep "$stable"
  state="$(systemctl is-active "$worker" 2>/dev/null || true)"
  restarts="$(systemctl show -p NRestarts --value "$worker" 2>/dev/null || echo 0)"
  if [[ "$state" != "active" ]] ||
    [[ "$(systemctl show -p MainPID --value "$worker" 2>/dev/null || echo 0)" != "$pid" ]] ||
    [[ "$restarts" != "$restarts_before" ]]; then
    echo "ERROR: worker $worker did not stay up after restart (state '$state'). Check: journalctl -u $worker -n 100" >&2
    return 1
  fi
  if [[ -n "$heartbeat" ]]; then
    local mtime
    mtime="$(stat -c %Y "$heartbeat" 2>/dev/null || echo 0)"
    if ((mtime < restart_at)); then
      echo "ERROR: worker heartbeat $heartbeat was not written since the restart." >&2
      return 1
    fi
  fi
  echo "OK: worker $worker active (pid $pid)."
  echo "Deployed $(git rev-parse HEAD)."
  return 0
}

main "$@"
exit $?
