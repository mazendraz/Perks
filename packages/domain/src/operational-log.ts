// Deliberately accepts no arbitrary error/payload object.
export function operationalLog(
  service: 'api' | 'worker',
  level: 'info' | 'error',
  event:
    | 'service.started'
    | 'service.start_failed'
    | 'service.stopped'
    | 'worker.iteration_failed'
    | 'wallet.design_resend'
    | 'wallet.apns_rejected'
    | 'wallet.apns_unreachable'
    | 'wallet.push_retry_scheduled'
    | 'analytics.refresh_failed',
  // Only numbers and Apple's fixed reason codes (e.g. BadDeviceToken); never tokens or serials.
  detail?: { status?: number; reason?: string; count?: number },
) {
  const safe = detail && {
    ...(typeof detail.status === 'number' ? { status: detail.status } : {}),
    ...(typeof detail.count === 'number' ? { count: detail.count } : {}),
    ...(detail.reason && /^[A-Za-z]{1,48}$/.test(detail.reason) ? { reason: detail.reason } : {}),
  };
  const line = JSON.stringify({ time: Date.now(), service, level, event, ...safe });
  if (level === 'error') console.error(line);
  else console.log(line);
}
