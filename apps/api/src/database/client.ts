export interface SqlQueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount: number | null;
}

export interface SqlClient {
  query<Row = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>>;
  release(): void;
}

export interface SqlPool {
  connect(): Promise<SqlClient>;
}

export interface SqlQueryablePool extends SqlPool {
  query<Row = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>>;
}

interface PostgresPoolOptions {
  connectionString: string;
  max: number;
  ssl: false | { rejectUnauthorized: true };
  application_name: string;
}

type PoolConstructor<T> = new (options: PostgresPoolOptions) => T;

export function createPostgresPool<T = Pool>(
  config: DatabaseConfig,
  PoolType: PoolConstructor<T> = Pool as unknown as PoolConstructor<T>,
): T {
  return new PoolType({
    connectionString: config.connectionString,
    max: config.maxConnections,
    ssl: config.ssl,
    application_name: "xuetu-api",
  });
}

export async function withTransaction<T>(
  pool: SqlPool,
  operation: (client: SqlClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original operation error; a broken connection is released below.
    }
    throw error;
  } finally {
    client.release();
  }
}
import { Pool } from "pg";

import type { DatabaseConfig } from "../config/database.js";
