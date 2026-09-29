import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const compose = readFileSync(new URL("compose.production.yml", root), "utf8");
const caddy = readFileSync(new URL("deploy/Caddyfile", root), "utf8");
const dockerfile = readFileSync(new URL("Dockerfile", root), "utf8");
const bootstrap = readFileSync(new URL("deploy/bootstrap-env.sh", root), "utf8");
const example = readFileSync(new URL("deploy/.env.production.example", root), "utf8");
const apiExample = readFileSync(new URL("apps/api/.env.example", root), "utf8");

function serviceBody(name: string, nextName: string) {
  const pattern = new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)\\n  ${nextName}:`, "u");
  return compose.match(pattern)?.[1] ?? "";
}

describe("production deployment authentication boundary", () => {
  it("publishes only the HTTPS reverse proxy and keeps the API on its private network", () => {
    expect(compose).toContain('XUETU_LISTEN_HOST: "0.0.0.0"');
    expect(compose).toMatch(/\$\{XUETU_HTTP_PORT:-80\}:80/u);
    expect(compose).toMatch(/\$\{XUETU_HTTPS_PORT:-443\}:443/u);
    expect(compose).toContain("caddy_data:/data");
    expect(serviceBody("postgres", "api")).not.toMatch(/\n    ports:/u);
    expect(serviceBody("api", "web")).not.toMatch(/\n    ports:/u);
  });

  it("terminates domestic-LAN HTTPS before forwarding to the API", () => {
    expect(caddy).toContain("{$XUETU_PUBLIC_ORIGIN}");
    expect(caddy).toContain("default_sni {$XUETU_TLS_SERVER_NAME}");
    expect(compose).toContain(
      "XUETU_TLS_SERVER_NAME: ${XUETU_TLS_SERVER_NAME:?XUETU_TLS_SERVER_NAME is required}",
    );
    expect(caddy).toContain("(tls_internal)");
    expect(caddy).toContain("tls internal");
    expect(caddy).toContain("(tls_acme)");
    expect(caddy).toContain("issuer acme");
    expect(caddy).toContain("profile shortlived");
    expect(caddy).toContain("import tls_{$XUETU_TLS_ISSUER}");
    expect(caddy).not.toContain("issuer {$XUETU_TLS_ISSUER}");
    expect(compose).toContain("XUETU_TLS_ISSUER: ${XUETU_TLS_ISSUER:-internal}");
    expect(caddy).toContain("reverse_proxy api:3001");
    expect(caddy).not.toMatch(/^:80\s*\{/mu);
  });

  it("refuses insecure production input and emits secure auth settings", () => {
    expect(bootstrap).toMatch(/XUETU_PUBLIC_ORIGIN/u);
    expect(bootstrap).toMatch(/XUETU_TLS_SERVER_NAME/u);
    expect(bootstrap).toMatch(/XUETU_TLS_ISSUER/u);
    expect(example).toContain("XUETU_TLS_ISSUER=internal");
    expect(bootstrap).toMatch(/https:\/\//u);
    expect(bootstrap).toContain("NODE_ENV=production");
    expect(bootstrap).toContain("XUETU_AUTH_COOKIE_SECURE=true");
    expect(bootstrap).toContain("XUETU_TRUST_PROXY=true");
    expect(bootstrap).toContain("XUETU_LISTEN_HOST=0.0.0.0");
    expect(bootstrap).toContain("XUETU_SYNC_DEMO_CREDENTIALS=false");
    expect(example).toContain("XUETU_SYNC_DEMO_CREDENTIALS=false");
    expect(bootstrap).not.toContain("NODE_ENV=demo");
    expect(bootstrap).not.toContain("XUETU_AUTH_COOKIE_SECURE=false");
  });

  it("requires an explicit server-side switch for local-demo past papers", () => {
    expect(compose).toContain(
      "XUETU_ALLOW_LOCAL_DEMO_PAST_EXAMS: ${XUETU_ALLOW_LOCAL_DEMO_PAST_EXAMS:?XUETU_ALLOW_LOCAL_DEMO_PAST_EXAMS is required}",
    );
    expect(apiExample).toContain("XUETU_ALLOW_LOCAL_DEMO_PAST_EXAMS=false");
    expect(example).toContain("XUETU_ALLOW_LOCAL_DEMO_PAST_EXAMS=false");
    expect(bootstrap).toContain("XUETU_ALLOW_LOCAL_DEMO_PAST_EXAMS=true");
  });

  it("refuses to overwrite credentials for an already initialized deployment", () => {
    const destinationGuard = bootstrap.indexOf(
      'if [ -e "$production_env" ] || [ -e "$credential_file" ]; then',
    );

    expect(destinationGuard).toBeGreaterThan(-1);
    expect(bootstrap).toContain("target deployment is already initialized");
    expect(destinationGuard).toBeLessThan(bootstrap.indexOf("database_password=$(openssl rand -hex 24)"));
  });

  it("runs the API as an unprivileged user with a writable private upload directory", () => {
    const apiImage = dockerfile.split("FROM workspace AS api")[1]?.split("FROM caddy:")[0] ?? "";
    const apiService = serviceBody("api", "web");

    expect(apiImage).toContain("mkdir -p /app/.runtime/external-questions");
    expect(apiImage).toContain("chown -R node:node /app/.runtime");
    expect(apiImage).toMatch(/USER node[\s\S]*CMD/u);
    expect(apiService).toMatch(/cap_drop:\s*\n\s*- ALL/u);
  });

  it("keeps copied workspace files readable by the unprivileged API user", () => {
    const workspaceImage = dockerfile.split("FROM node:24.16.0-bookworm-slim AS workspace")[1]
      ?.split("FROM workspace AS web-build")[0] ?? "";
    const copyInstructions = workspaceImage.split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("COPY "));

    expect(copyInstructions.length).toBeGreaterThan(0);
    expect(copyInstructions.every((line) => line.startsWith("COPY --chown=node:node "))).toBe(true);
  });

  it("starts the API from installed workspace binaries without a runtime package-manager download", () => {
    const apiImage = dockerfile.split("FROM workspace AS api")[1]?.split("FROM caddy:")[0] ?? "";

    expect(apiImage).toContain("WORKDIR /app/apps/api");
    expect(apiImage).toContain('CMD ["./node_modules/.bin/tsx", "src/server.ts", "--lan"]');
    expect(apiImage).not.toMatch(/CMD \["pnpm"/u);
  });
});
