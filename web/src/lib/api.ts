import { useAuth } from '../stores/auth';
import { toast } from '../stores/ui';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Full sign-out (socket teardown + store reset) is registered by App to avoid
// an import cycle between the api client, the stores and the socket module.
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  unauthorizedHandler = fn;
}

// When the app is served under a URL prefix (e.g. /atrium/), API calls carry it too.
const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export async function api<T = any>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown
): Promise<T> {
  const token = useAuth.getState().token;
  let res: Response;
  try {
    res = await fetch(API_BASE + url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Network problem — check your connection');
  }
  if (res.status === 401) {
    // Token expired or revoked: tear everything down and drop back to login
    if (unauthorizedHandler) unauthorizedHandler();
    else useAuth.getState().logout();
    throw new ApiError(401, 'Session expired — please sign in again');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, json?.error || 'Request failed');
  }
  return json as T;
}

/**
 * Wrap a user-initiated mutation so a failure is never silent: shows an error
 * toast (and an optional success toast) and rethrows for callers that branch.
 *   await mutate(api('POST', …), { success: 'Task added' });
 */
export async function mutate<T>(
  promise: Promise<T>,
  opts: { success?: string; errorTitle?: string } = {}
): Promise<T> {
  try {
    const result = await promise;
    if (opts.success) toast({ kind: 'success', title: opts.success, ttl: 2500 });
    return result;
  } catch (err: any) {
    if (!(err instanceof ApiError && err.status === 401)) {
      toast({
        kind: 'error',
        title: opts.errorTitle || "That didn't work",
        body: err?.message || 'Please try again.',
      });
    }
    throw err;
  }
}

/** Same as mutate, but resolves to undefined instead of throwing (fire-and-forget UI actions). */
export function tryMutate<T>(promise: Promise<T>, opts?: { success?: string; errorTitle?: string }) {
  return mutate(promise, opts).catch(() => undefined);
}
