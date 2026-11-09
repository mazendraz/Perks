#!/usr/bin/env bash
# Optional Windows/WSL performance runner. CI on Linux uses its native Node/browser.
set -euo pipefail
workspace=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
node_version=${1:?Pass the host Node version, e.g. v24.19.0}
[[ "$node_version" =~ ^v24\.[0-9]+\.[0-9]+$ ]] || { echo 'Node24 is required.' >&2; exit 1; }
[[ "${WSL_DISTRO_NAME:-}" =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'Run inside a named WSL distribution.' >&2; exit 1; }
task_root="$workspace/.local/linux-motion"
mkdir -p "$task_root"
cd "$task_root"
archive="node-$node_version-linux-x64.tar.xz"
if [[ ! -x "$task_root/node-$node_version-linux-x64/bin/node" ]]; then
  curl --fail --silent --show-error --location "https://nodejs.org/dist/$node_version/$archive" --output "$archive"
  curl --fail --silent --show-error --location "https://nodejs.org/dist/$node_version/SHASUMS256.txt" --output SHASUMS256.txt
  awk -v file="$archive" '$2==file' SHASUMS256.txt | sha256sum --check --strict
  tar -xf "$archive" "node-$node_version-linux-x64/bin/node"
fi
export PATH="$task_root/node-$node_version-linux-x64/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH="$task_root/browsers"
args=(install --only-shell chromium)
if [[ "${2:-}" == --with-deps ]]; then args+=(--with-deps); fi
node "$workspace/node_modules/playwright/cli.js" "${args[@]}"
printf '{"distro":"%s","nodeVersion":"%s"}\n' "$WSL_DISTRO_NAME" "$node_version" > "$workspace/.local/motion-linux-runtime.json"
printf '%s\n' 'Linux animation runner ready; npm run test:animation still enforces32ms for both live and traced frames.'
