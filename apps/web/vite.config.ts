import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

const API_PROXY_DEFAULT_TARGET = "http://127.0.0.1:3001";
const API_PROXY_AGENT_OPTIONS = {
  keepAlive: true,
  keepAliveMsecs: 1_000,
  maxSockets: 32,
  maxFreeSockets: 8,
};

export function createApiProxyOptions(target: string): ProxyOptions {
  const protocol = new URL(target).protocol;
  const agent = protocol === "https:"
    ? new HttpsAgent(API_PROXY_AGENT_OPTIONS)
    : new HttpAgent(API_PROXY_AGENT_OPTIONS);

  return {
    target,
    agent,
  };
}

const apiProxyTarget = process.env.API_PROXY_TARGET ?? API_PROXY_DEFAULT_TARGET;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Windows can miss replacement events for existing source files.
    watch: { usePolling: process.platform === "win32", interval: 500 },
    proxy: {
      "/api": createApiProxyOptions(apiProxyTarget),
    },
  },
});
