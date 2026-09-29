import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import * as authSecurity from "../src/services/auth/auth-security.js";

describe("development identity header security", () => {
  it("keeps JSON bounded while registering multipart for route-local image limits", () => {
    const source = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
    expect(source).toContain('bodyLimit: 512 * 1024');
    expect(source).toMatch(/register\(.*multipart/u);
    expect(source).not.toContain("bodyLimit: 5 * 1024 * 1024");
  });

  it("requires a second explicit opt-in and rejects production enablement", () => {
    const resolver = (authSecurity as Record<string, unknown>)
      .resolveLocalDevIdentityHeader;
    expect(typeof resolver).toBe("function");
    if (typeof resolver !== "function") return;

    const resolve = resolver as (
      environment: Record<string, string | undefined>,
    ) => boolean;
    expect(resolve({ XUETU_AUTH_MODE: "local_dev" })).toBe(false);
    expect(resolve({
      XUETU_AUTH_MODE: "local_dev",
      XUETU_ENABLE_DEV_IDENTITY_HEADER: "true",
    })).toBe(true);
    expect(() => resolve({
      NODE_ENV: "production",
      XUETU_AUTH_MODE: "local_dev",
      XUETU_ENABLE_DEV_IDENTITY_HEADER: "true",
    })).toThrow(/production/iu);
  });

  it("forces secure cookies in production behind an HTTPS proxy", () => {
    expect(authSecurity.resolveAuthCookieSecure({
      NODE_ENV: "production",
      XUETU_TRUST_PROXY: "true",
      XUETU_PUBLIC_ORIGIN: "https://xuetu.lan",
    })).toBe(true);
    expect(() => authSecurity.resolveAuthCookieSecure({
      NODE_ENV: "production",
      XUETU_TRUST_PROXY: "true",
      XUETU_AUTH_COOKIE_SECURE: "false",
      XUETU_PUBLIC_ORIGIN: "https://xuetu.lan",
    })).toThrow(/Secure/u);
  });

  it("allows a trusted proxy in an explicitly non-production HTTP demo", () => {
    expect(authSecurity.resolveAuthCookieSecure({
      NODE_ENV: "demo",
      XUETU_TRUST_PROXY: "true",
      XUETU_AUTH_COOKIE_SECURE: "false",
    })).toBe(false);
  });

  it("trusts forwarded addresses only from local and private proxy networks", () => {
    expect(authSecurity.resolveTrustedProxy({})).toBe(false);
    expect(authSecurity.resolveTrustedProxy({
      XUETU_TRUST_PROXY: "false",
    })).toBe(false);
    expect(authSecurity.resolveTrustedProxy({
      XUETU_TRUST_PROXY: "true",
    })).toEqual([
      "127.0.0.0/8",
      "::1/128",
      "10.0.0.0/8",
      "172.16.0.0/12",
      "192.168.0.0/16",
      "169.254.0.0/16",
      "fc00::/7",
      "fe80::/10",
    ]);
    expect(() => authSecurity.resolveTrustedProxy({
      XUETU_TRUST_PROXY: "all",
    })).toThrow(/true or false/iu);
  });

  it("rejects production cookies when the declared browser origin is plain HTTP", () => {
    expect(() => authSecurity.resolveAuthCookieSecure({
      NODE_ENV: "production",
      XUETU_PUBLIC_ORIGIN: "http://192.168.1.20:5173",
    })).toThrow(/HTTPS/iu);
    expect(authSecurity.resolveAuthCookieSecure({
      NODE_ENV: "production",
      XUETU_PUBLIC_ORIGIN: "https://xuetu.lan",
    })).toBe(true);
  });
});
