import { isIP } from "node:net";

export class ListenHostConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListenHostConfigurationError";
  }
}

export function resolveListenHost(
  arguments_: readonly string[],
  environment: Record<string, string | undefined> = process.env,
) {
  const configured = environment.XUETU_LISTEN_HOST?.trim();
  if (configured) {
    if (isIP(configured) === 0) {
      throw new ListenHostConfigurationError(
        "XUETU_LISTEN_HOST must be an IPv4 or IPv6 address.",
      );
    }
    return configured;
  }

  if (environment.NODE_ENV === "production") return "127.0.0.1";
  return arguments_.includes("--lan") ? "0.0.0.0" : "127.0.0.1";
}
