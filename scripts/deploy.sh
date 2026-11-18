#!/usr/bin/env bash
# Manual deploy for the Perks VPS. Run ON the server as the `perks` user.
#   bash scripts/deploy.sh
# Overridable env: APP_DIR, DEPLOY_USER, DEPLOY_BRANCH, HEALTH_URL, HEALTH_TRIES
set -euo pipefail

# Everything lives in main() and the script exits before the closing line, so
# bash never re-reads a file that `git pull` replaced while we are running.
main() {
  local app_dir="${APP_DIR:-/opt/perks}"
  local deploy_user="${DEPLOY_USER:-perks}"
  local branch="${DEPLOY_BRANCH:-master}"
  local health_url="${HEALTH_URL:-http://127.0.0.1:4100/health/ready}"
  local tries="${HEALTH_TRIES:-30}"

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

  echo "==> Commits about to be deployed (HEAD..origin/$branch):"
  if [[ -n "$(git log --oneline "HEAD..origin/$branch")" ]]; then
    git log --no-decorate --format='%h %an  %s' "HEAD..origin/$branch"
  else
    echo "(none - already up to date)"
  fi

  echo "==> git pull --ff-only"
  git pull --ff-only origin "$branch"

  echo "==> npm ci"
  npm ci

  echo "==> npm run build"
  npm run build

  echo "==> npm run db:migrate"
  npm run db:migrate

  echo "==> Restarting services"
  # Must match the sudoers rule exactly (arguments are matched literally).
  sudo systemctl restart perks perks-worker

  echo "==> Health check: $health_url"
  local code="000" i
  for ((i = 1; i <= tries; i++)); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$health_url" || true)"
    if [[ "$code" == "200" ]]; then
      echo "OK: /health/ready returned 200 (attempt $i)."
      echo "Deployed $(git rev-parse --short HEAD)."
      return 0
    fi
    echo "  attempt $i/$tries: HTTP $code"
    sleep 2
  done

  echo "ERROR: health check did not return 200 (last: $code). Check: journalctl -u perks -u perks-worker -n 100" >&2
  return 1
}

main "$@"
exit $?
