import { spawn } from 'node:child_process';
const processes = [
  spawn(process.execPath, ['--watch', '--import', 'tsx', 'apps/api/src/main.ts'], {
    stdio: 'inherit',
    windowsHide: true,
  }),
  spawn(process.execPath, ['--watch', '--import', 'tsx', 'apps/worker/src/main.ts'], {
    stdio: 'inherit',
    windowsHide: true,
  }),
  spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--config', 'apps/web/vite.config.ts', 'apps/web'],
    { stdio: 'inherit', windowsHide: true },
  ),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of processes) child.kill();
}
for (const p of processes)
  p.on('exit', () => {
    stop();
  });
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
