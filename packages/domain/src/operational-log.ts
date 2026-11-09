// Deliberately accepts no arbitrary error/payload object.
export function operationalLog(
  service: 'api' | 'worker',
  level: 'info' | 'error',
  event: 'service.started' | 'service.start_failed' | 'service.stopped' | 'worker.iteration_failed',
) {
  const line = JSON.stringify({ time: Date.now(), service, level, event });
  if (level === 'error') console.error(line);
  else console.log(line);
}
