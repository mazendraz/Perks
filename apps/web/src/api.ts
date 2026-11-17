import type { ApiFailure, Session } from '../../../packages/contracts/src/index.js';
import { portalForPath, type Portal } from './portals.js';
import { setNetworkUnavailable } from './network.js';
import { messageFor, type ErrorDetails } from './error-messages.js';
let csrf = '';
let ownerPreview: { merchantId: string; staffId: string } | null = null;
export function setOwnerPreview(value: typeof ownerPreview) {
  ownerPreview = value;
}
export function setCsrf(value: string) {
  csrf = value;
}
export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public requestId?: string,
    public fields: { path: string; code: string }[] = [],
    /** Plan limit numbers and the ways out, when the server sent them. */
    public details?: ErrorDetails,
  ) {
    super(code);
  }
}
function planDetails(error: unknown): ErrorDetails | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as Record<string, unknown>;
  if (e.code !== 'PLAN_LIMIT_REACHED' && e.code !== 'FEATURE_NOT_IN_PLAN') return undefined;
  return {
    entitlement: typeof e.entitlement === 'string' ? e.entitlement : undefined,
    limit: typeof e.limit === 'number' ? e.limit : undefined,
    used: typeof e.used === 'number' ? e.used : undefined,
    options: Array.isArray(e.options) ? (e.options as ErrorDetails['options']) : undefined,
  };
}
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    key?: string;
    revision?: number;
    workspace?: Portal | 'shared';
    timeoutMs?: number;
  } = {},
  restoreDevice = true,
): Promise<T> {
  const headers: Record<string, string> = {};
  headers['x-nuqta-language'] = document.documentElement.lang === 'en' ? 'en' : 'ar';
  const authEntry = path === '/auth/login' || path === '/auth/register';
  const portal =
    options.workspace === 'shared'
      ? undefined
      : options.workspace ||
        (authEntry
          ? location.pathname.startsWith('/join/')
            ? 'customer'
            : undefined
          : portalForPath(location.pathname));
  if (portal) headers['x-nuqta-workspace'] = portal;
  const preview =
    ownerPreview &&
    location.pathname === '/platform/merchants/' + ownerPreview.merchantId + '/owner-view'
      ? ownerPreview
      : null;
  if (
    preview &&
    path !== '/auth/logout' &&
    path !== '/session' &&
    path !== '/platform/merchants/' + preview.merchantId + '/owner-preview'
  ) {
    if ((options.method || 'GET') !== 'GET') throw new ApiError('OWNER_PREVIEW_READ_ONLY', 403);
    headers['x-nuqta-owner-preview'] = preview.merchantId + ':' + preview.staffId;
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.method && options.method !== 'GET') headers['x-csrf-token'] = csrf;
  if (options.key) headers['Idempotency-Key'] = options.key;
  if (options.revision !== undefined) headers['If-Match'] = String(options.revision);
  let response: Response;
  let body: T & ApiFailure;
  const controller = options.timeoutMs ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), options.timeoutMs) : undefined;
  try {
    response = await fetch('/api/v1' + path, {
      credentials: 'same-origin',
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller?.signal,
    });
    if (response.status === 204) {
      setNetworkUnavailable(false);
      return undefined as T;
    }
    body = (await response.json()) as T & ApiFailure;
  } catch {
    if (controller?.signal.aborted) throw new ApiError('REQUEST_TIMEOUT', 0);
    setNetworkUnavailable(true);
    throw new ApiError('NETWORK_UNCERTAIN', 0);
  } finally {
    clearTimeout(timer);
  }
  setNetworkUnavailable(false);
  if (
    restoreDevice &&
    portal === 'customer' &&
    path !== '/session' &&
    ((response.status === 401 && body.error?.code === 'UNAUTHENTICATED') ||
      (response.status === 403 && body.error?.code === 'CSRF_REJECTED'))
  ) {
    try {
      const session = await api<Session>('/session', { workspace: 'customer' }, false);
      csrf = session.csrfToken;
      window.dispatchEvent(new Event('nuqta:customer-session-restored'));
      // Authentication/CSRF rejected the first attempt before its handler ran.
      // Retry once, retaining the exact commercial command and idempotency key.
      return api<T>(path, options, false);
    } catch {
      /* A revoked or absent device must still receive the original failure. */
    }
  }
  if (response.status === 403 && body.error?.code === 'MFA_REQUIRED')
    window.dispatchEvent(new Event('nuqta:mfa-required'));
  if (
    path !== '/session' &&
    response.status === 401 &&
    csrf &&
    body.error?.code === 'UNAUTHENTICATED'
  ) {
    csrf = '';
    window.dispatchEvent(new Event('nuqta:session-expired'));
  }
  if (!response.ok) {
    const error = new ApiError(
      body.error?.code || 'REQUEST_FAILED',
      response.status,
      body.error?.requestId,
      body.error?.fields,
      planDetails(body.error),
    );
    // A shop action hit the plan: the merchant workspace opens the limit sheet with the ways out.
    if (error.details?.options?.length && (options.method || 'GET') !== 'GET')
      window.dispatchEvent(new CustomEvent('perks:plan-limit', { detail: error }));
    throw error;
  }
  return body;
}
/** Shown text for any failure: plain words, the cause and the fix (see error-messages.ts). */
export function errorText(error: unknown, lang: 'ar' | 'en' = 'ar') {
  const audience = portalForPath(location.pathname) === 'customer' ? 'customer' : 'staff';
  if (error instanceof ApiError)
    return messageFor(error.code, lang, audience, error.details, error.requestId);
  return messageFor('REQUEST_FAILED', lang, audience);
}
