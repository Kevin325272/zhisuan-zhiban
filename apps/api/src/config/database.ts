export interface DatabaseConfig {
  connectionString: string;
  maxConnections: number;
  ssl: false | { rejectUnauthorized: true };
}

export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

export function readDatabaseConfig(
  environment: Record<string, string | undefined> = process.env,
): DatabaseConfig {
  const connectionString = environment.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new DatabaseConfigurationError(
      "DATABASE_URL is required; JSON files are not a runtime database.",
    );
  }
  if (!/^postgres(?:ql)?:\/\//u.test(connectionString)) {
    throw new DatabaseConfigurationError(
      "DATABASE_URL must use postgresql:// or postgres://",
    );
  }

  const maxConnections = Number(environment.DATABASE_POOL_MAX ?? 10);
  if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 50) {
    throw new DatabaseConfigurationError(
      "DATABASE_POOL_MAX must be between 1 and 50",
    );
  }

  const sslMode = (environment.DATABASE_SSL ?? "disable").trim().toLowerCase();
  if (sslMode !== "disable" && sslMode !== "require") {
    throw new DatabaseConfigurationError(
      "DATABASE_SSL must be either disable or require",
    );
  }

  return {
    connectionString,
    maxConnections,
    ssl: sslMode === "require" ? { rejectUnauthorized: true } : false,
  };
}
