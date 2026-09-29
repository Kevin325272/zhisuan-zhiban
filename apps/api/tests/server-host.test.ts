import { describe, expect, it } from "vitest";

import {
  ListenHostConfigurationError,
  resolveListenHost,
} from "../src/config/listen-host.js";

describe("API listen host", () => {
  it("keeps loopback as the default development boundary", () => {
    expect(resolveListenHost([])).toBe("127.0.0.1");
    expect(resolveListenHost(["--inspect"])).toBe("127.0.0.1");
  });

  it("binds all interfaces only when LAN mode is explicit", () => {
    expect(resolveListenHost(["--lan"])).toBe("0.0.0.0");
  });

  it("does not let proxy trust change the requested LAN binding", () => {
    expect(resolveListenHost(["--lan"], {
      NODE_ENV: "demo",
      XUETU_TRUST_PROXY: "true",
    })).toBe("0.0.0.0");
  });

  it("keeps production loopback by default but permits an explicit container binding", () => {
    expect(resolveListenHost(["--lan"], {
      NODE_ENV: "production",
    })).toBe("127.0.0.1");
    expect(resolveListenHost(["--lan"], {
      NODE_ENV: "production",
      XUETU_LISTEN_HOST: "0.0.0.0",
    })).toBe("0.0.0.0");
    expect(resolveListenHost([], {
      NODE_ENV: "production",
      XUETU_LISTEN_HOST: "::",
    })).toBe("::");
  });

  it("rejects non-IP listen-host overrides", () => {
    expect(() => resolveListenHost([], {
      XUETU_LISTEN_HOST: "all-interfaces",
    })).toThrow(ListenHostConfigurationError);
  });
});
