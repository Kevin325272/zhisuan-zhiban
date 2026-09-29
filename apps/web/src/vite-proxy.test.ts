import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { describe, expect, it } from "vitest";

import config, { createApiProxyOptions } from "../vite.config";

describe("Vite API proxy", () => {
  it("uses a keep-alive HTTP agent for the local API target", () => {
    const proxy = createApiProxyOptions("http://127.0.0.1:3001");

    expect(proxy.target).toBe("http://127.0.0.1:3001");
    expect(proxy.agent).toBeInstanceOf(HttpAgent);
    expect(proxy.agent.options.keepAlive).toBe(true);
  });

  it("uses an HTTPS agent when the API target is HTTPS", () => {
    const proxy = createApiProxyOptions("https://api.example.test");

    expect(proxy.agent).toBeInstanceOf(HttpsAgent);
    expect(proxy.agent.options.keepAlive).toBe(true);
  });

  it("registers the configured API target with Vite", () => {
    const proxy = config.server?.proxy?.["/api"];
    const target = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3001";

    expect(proxy).toEqual(expect.objectContaining({ target }));
  });
});
