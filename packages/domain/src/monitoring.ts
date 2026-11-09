// Bounded, process-local five-minute histogram; no routes, IDs or contact data.
const bounds = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, Infinity];
type Bucket = { second: number; requests: number; errors: number; timings: number[] };
export class HttpMetrics {
  private buckets: Bucket[] = Array.from({ length: 300 }, () => ({
    second: -Infinity,
    requests: 0,
    errors: 0,
    timings: bounds.map(() => 0),
  }));
  private requests = 0;
  private errors = 0;
  observe(status: number, durationMs: number | null, now = Date.now()) {
    const second = Math.floor(now / 1000),
      index = ((second % 300) + 300) % 300;
    let bucket = this.buckets[index]!;
    if (bucket.second !== second) {
      bucket = { second, requests: 0, errors: 0, timings: bounds.map(() => 0) };
      this.buckets[index] = bucket;
    }
    bucket.requests++;
    this.requests++;
    if (status >= 500 && status < 600) {
      bucket.errors++;
      this.errors++;
    }
    if (durationMs !== null && Number.isFinite(durationMs) && durationMs >= 0) {
      const bin = bounds.findIndex((value) => durationMs <= value);
      bucket.timings[bin] = bucket.timings[bin]! + 1;
    }
  }
  snapshot(now = Date.now()) {
    const second = Math.floor(now / 1000),
      timings = bounds.map(() => 0);
    let requests = 0,
      errors = 0;
    for (const bucket of this.buckets) {
      if (bucket.second > second || bucket.second <= second - 300) continue;
      requests += bucket.requests;
      errors += bucket.errors;
      bucket.timings.forEach((count, index) => {
        timings[index] = timings[index]! + count;
      });
    }
    const timedRequests = timings.reduce((sum, count) => sum + count, 0);
    let accumulated = 0,
      p95: number | null = null;
    if (timedRequests)
      for (const [index, count] of timings.entries()) {
        accumulated += count;
        if (accumulated >= Math.ceil(timedRequests * 0.95)) {
          p95 = bounds[index]!;
          break;
        }
      }
    return {
      total: { requests: this.requests, errors: this.errors },
      window: {
        seconds: 300,
        resolutionSeconds: 1,
        requests,
        errors,
        errorRatio: requests ? errors / requests : 0,
        timedRequests,
        p95Ms: p95 !== null && Number.isFinite(p95) ? p95 : null,
        p95Above60000ms: p95 === Infinity,
      },
    };
  }
}
export function operationalHealth(input: {
  errorRatio: number;
  diskUsedRatio: number | null;
  databaseHealthy: boolean;
  oldestPendingAgeMs: number | null;
  backupsHealthy: boolean;
}) {
  const reasons: string[] = [];
  if (!input.databaseHealthy) reasons.push('database_unavailable');
  if (input.errorRatio > 0.01) reasons.push('http_5xx_above_1_percent');
  if (input.diskUsedRatio === null) reasons.push('disk_unavailable');
  else if (input.diskUsedRatio > 0.8) reasons.push('disk_above_80_percent');
  if (input.oldestPendingAgeMs !== null && input.oldestPendingAgeMs > 15 * 60000)
    reasons.push('outbox_older_than_15m');
  if (!input.backupsHealthy) reasons.push('backup_unhealthy');
  return { healthy: reasons.length === 0, reasons };
}
