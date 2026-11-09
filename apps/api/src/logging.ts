import type {
  FastifyServerOptions,
  FastifyReply,
  FastifyRequest,
  FastifyBaseLogger,
} from 'fastify';
const methods = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']);
const method = (value: string) => (methods.has(value) ? value : 'OTHER');
const generatedId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const trusted = new WeakSet<object>();
function record<T extends object>(value: T) {
  trusted.add(value);
  return Object.freeze(value);
}
export function apiLogger(
  level: string,
  stream?: { write: (line: string) => void },
  root: { logger?: FastifyBaseLogger } = {},
): Exclude<FastifyServerOptions['logger'], boolean | undefined> {
  return {
    level,
    base: { service: 'api' },
    ...(stream ? { stream } : {}),
    hooks: {
      // Unknown plugin/framework strings can contain errors, URLs or headers.
      // Only these frozen allowlisted records may carry structured details.
      logMethod(args, write) {
        const value = args[0];
        const detail =
          value && typeof value === 'object' && trusted.has(value)
            ? value
            : { event: 'framework.event' };
        const bindings = this.bindings();
        // Raw child bindings bypass some formatter paths. Write through the
        // root and carry only the generated request ID, never arbitrary binds.
        Reflect.apply(write, root.logger ?? this, [
          {
            ...detail,
            ...(typeof bindings.reqId === 'string' && generatedId.test(bindings.reqId)
              ? { reqId: bindings.reqId }
              : {}),
          },
        ]);
      },
    },
    formatters: {
      bindings(value) {
        return {
          ...(value.service === 'api' ? { service: 'api' } : {}),
          ...(typeof value.reqId === 'string' && generatedId.test(value.reqId)
            ? { reqId: value.reqId }
            : {}),
        };
      },
    },
    serializers: {
      // Fastify can serialize a request before routing. Never use its raw URL,
      // query, host, headers, body or remote IP, even on unknown/error paths.
      req: (req) => ({ method: method(req.method || '') }),
      res: (res) => ({ statusCode: res.statusCode }),
      err: () => ({ type: 'UnexpectedError', message: '[redacted]', stack: '' }),
    },
    redact: {
      paths: ['password', 'token', 'secret', 'req.body', 'req.headers', 'res.headers'],
      censor: '[redacted]',
    },
  };
}
export function httpLog(req: FastifyRequest, reply: FastifyReply) {
  return record({
    event: 'http.request',
    requestId: req.id,
    method: method(req.method),
    route: req.routeOptions.url || '[unmatched]',
    statusCode: reply.statusCode,
    durationMs: Math.round(reply.elapsedTime * 100) / 100,
  });
}
export function failureLog(requestId: string) {
  return record({
    event: 'http.failed',
    errorType: 'UnexpectedError',
    requestId: generatedId.test(requestId) ? requestId : '[unavailable]',
  });
}
