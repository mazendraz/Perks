import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const root = resolve('.');
const linuxRoot =
  process.platform === 'win32'
    ? root
        .replace(/^([a-zA-Z]):/, (_, drive: string) => '/mnt/' + drive.toLowerCase())
        .replaceAll('\\', '/')
    : root;
const script = `set -eu
repo="$1"
for script in init-secrets.sh harden-host.sh postgres/init-roles.sh restore-drill.sh backup/files.sh backup/files-loop.sh; do sh -n "$repo/deploy/$script"; done
python3 - "$repo" <<'PY'
import ast,pathlib,sys
for script in pathlib.Path(sys.argv[1],'deploy','backup').glob('*.py'): ast.parse(script.read_text())
PY
fixture=$(mktemp -d /tmp/nuqta-secret-test.XXXXXXXX)
case "$fixture" in /tmp/nuqta-secret-test.*) ;; *) exit 1;; esac
cp "$repo/deploy/init-secrets.sh" "$fixture/init-secrets.sh"
sh "$fixture/init-secrets.sh" >/dev/null
test "$(stat -c %a "$fixture/.env.production")" = 600
cp "$fixture/.env.production" "$fixture/original"
if sh "$fixture/init-secrets.sh" >/dev/null 2>&1; then exit 1; fi
cmp "$fixture/.env.production" "$fixture/original"
test "$(awk -F= '/^(AUTH_PEPPER|NUQTA_.*PASSWORD|PGBACKREST_REPO1_CIPHER_PASS|RESTIC_PASSWORD)=/ {print $2}' "$fixture/original" | sort -u | wc -l)" = 8
test "$(awk -F= '/^(AUTH_PEPPER|NUQTA_.*PASSWORD|PGBACKREST_REPO1_CIPHER_PASS|RESTIC_PASSWORD)=/ && length($2)==64 {n++} END {print n}' "$fixture/original")" = 8
rm -- "$fixture/init-secrets.sh" "$fixture/.env.production" "$fixture/original"
rmdir -- "$fixture"
`;
const windows = process.platform === 'win32';
const result = spawnSync(
  windows ? 'wsl' : 'sh',
  windows ? ['-d', 'Ubuntu', '--exec', 'sh', '-s', '--', linuxRoot] : ['-s', '--', linuxRoot],
  { input: script, encoding: 'utf8', timeout: 30000, windowsHide: true },
);
const source: Record<string, string> = {};
for (const path of [
  'deploy/init-secrets.sh',
  'deploy/harden-host.sh',
  'deploy/postgres/init-roles.sh',
  'tools/test-deploy-scripts.ts',
  'deploy/restore-drill.sh',
  'deploy/backup/db-loop.py',
  'deploy/backup/verify-restore.py',
  'deploy/backup/files.sh',
  'deploy/backup/files-loop.sh',
])
  source[path] = createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
const report = {
  at: new Date().toISOString(),
  status: result.status === 0 ? 'passed' : 'failed',
  runtime: windows ? 'WSL Ubuntu' : 'POSIX shell',
  checks:
    result.status === 0
      ? [
          'Shell syntax',
          'Generated secrets are 0600 and eight distinct 64-character values',
          'Existing configuration is byte-identical after refused overwrite',
        ]
      : [],
  source,
  hostHardeningExecuted: false,
};
await mkdir('docs/execution/evidence/implementation', { recursive: true });
await writeFile(
  'docs/execution/evidence/implementation/deployment-scripts.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({ status: report.status, checks: report.checks, hostHardeningExecuted: false }),
);
if (result.status !== 0) process.exitCode = 1;
