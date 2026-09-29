import type { FastifyRequest } from "fastify";

import type { LocalAuthenticationService, PublicAccount } from "./authentication.js";
import type { PlatformAccessService, PlatformActor } from "../platform-access.js";

export type RequestIdentitySource = "session" | "local_dev";

export interface RequestIdentity {
  userId: string;
  roles: PublicAccount["roles"];
  account: PublicAccount | null;
  actor: PlatformActor | null;
  source: RequestIdentitySource;
}

export interface RequestIdentityOptions {
  authentication?: LocalAuthenticationService | null;
  platformAccess?: PlatformAccessService | null;
  allowLocalDevAuth: boolean;
}

const requestIdentityCache = new WeakMap<
  FastifyRequest,
  Promise<RequestIdentity | null>
>();

export function readRequestCookie(request: FastifyRequest, name: string) {
  const raw = request.headers.cookie;
  if (!raw) return null;
  for (const item of raw.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function localDevUserId(request: FastifyRequest) {
  const raw = request.headers["x-dev-user-id"];
  return Array.isArray(raw) ? (raw[0] ?? null) : (raw ?? null);
}

/**
 * Resolve a server session first. The X-Dev header is intentionally only a
 * compatibility fallback for explicit local API tests; a browser request
 * with a cookie never silently changes identity based on that header.
 */
async function resolveUncachedRequestIdentity(
  request: FastifyRequest,
  options: RequestIdentityOptions,
  cookieName = "xuetu_session",
): Promise<RequestIdentity | null> {
  const token = readRequestCookie(request, cookieName);
  if (token && options.authentication) {
    const session = await options.authentication.resolveSession(token);
    if (!session) return null;
    if (session.account.must_change_password) return null;
    return {
      userId: session.account.user_id,
      roles: session.account.roles,
      account: session.account,
      actor: null,
      source: "session",
    };
  }
  if (token) return null;
  if (!options.allowLocalDevAuth || !options.platformAccess) return null;
  const userId = localDevUserId(request);
  if (!userId) return null;
  const actor = await options.platformAccess.getActor(userId);
  if (!actor) return null;
  return {
    userId,
    roles: actor.roles,
    account: null,
    actor,
    source: "local_dev",
  };
}

export function resolveRequestIdentity(
  request: FastifyRequest,
  options: RequestIdentityOptions,
  cookieName = "xuetu_session",
): Promise<RequestIdentity | null> {
  const cached = requestIdentityCache.get(request);
  if (cached) return cached;

  const pending = resolveUncachedRequestIdentity(request, options, cookieName).catch(
    (error: unknown) => {
      requestIdentityCache.delete(request);
      throw error;
    },
  );
  requestIdentityCache.set(request, pending);
  return pending;
}
