export class AuthSecurityConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthSecurityConfigurationError";
  }
}

const TRUSTED_PROXY_CIDRS = [
  "127.0.0.0/8",
  "::1/128",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "169.254.0.0/16",
  "fc00::/7",
  "fe80::/10",
] as const;

function optionalBoolean(
  environment: Record<string, string | undefined>,
  key: string,
) {
  const value = environment[key]?.trim().toLowerCase();
  if (value && value !== "true" && value !== "false") {
    throw new AuthSecurityConfigurationError(`${key} must be true or false.`);
  }
  return value;
}

export function resolveTrustedProxy(
  environment: Record<string, string | undefined> = process.env,
): false | string[] {
  const enabled = optionalBoolean(environment, "XUETU_TRUST_PROXY");
  return enabled === "true" ? [...TRUSTED_PROXY_CIDRS] : false;
}

export function resolveAuthCookieSecure(
  environment: Record<string, string | undefined> = process.env,
) {
  const configured = optionalBoolean(environment, "XUETU_AUTH_COOKIE_SECURE");
  optionalBoolean(environment, "XUETU_TRUST_PROXY");
  const secureTransportRequired = environment.NODE_ENV === "production";
  if (secureTransportRequired) {
    const origin = environment.XUETU_PUBLIC_ORIGIN?.trim();
    if (!origin) {
      throw new AuthSecurityConfigurationError(
        "生产或 HTTPS 反代模式必须配置 XUETU_PUBLIC_ORIGIN=https://...。",
      );
    }
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new AuthSecurityConfigurationError("XUETU_PUBLIC_ORIGIN 不是有效 URL。" );
    }
    if (parsedOrigin.protocol !== "https:") {
      throw new AuthSecurityConfigurationError(
        "Secure session cookies require an HTTPS browser origin when forwarded proto is trusted.",
      );
    }
    if (parsedOrigin.username || parsedOrigin.password) {
      throw new AuthSecurityConfigurationError(
        "XUETU_PUBLIC_ORIGIN 不能包含认证信息。",
      );
    }
    if (configured === "false") {
      throw new AuthSecurityConfigurationError("HTTPS deployments require Secure session cookies.");
    }
    return true;
  }
  return configured === "true";
}

export function resolveLocalDevIdentityHeader(
  environment: Record<string, string | undefined> = process.env,
) {
  const enabled = optionalBoolean(environment, "XUETU_ENABLE_DEV_IDENTITY_HEADER");
  const requested = environment.XUETU_AUTH_MODE?.trim().toLowerCase() === "local_dev"
    && enabled === "true";
  if (requested && environment.NODE_ENV === "production") {
    throw new AuthSecurityConfigurationError(
      "The development identity header cannot be enabled in production.",
    );
  }
  return requested;
}
