import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDatabase = globalThis as unknown as {
  postgresClient?: ReturnType<typeof postgres>;
};

function getClient() {
  const configuredConnectionString = process.env.DATABASE_URL;
  if (!configuredConnectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  let connectionString = configuredConnectionString;
  try {
    const connectionUrl = new URL(configuredConnectionString);
    if (
      connectionUrl.username.endsWith(".ctdeulxlvazwbkvkobud") &&
      connectionUrl.hostname.endsWith(".pooler.supabase.com")
    ) {
      connectionUrl.hostname = "aws-1-eu-central-1.pooler.supabase.com";
      connectionUrl.port = "6543";
      connectionString = connectionUrl.toString();
    }
  } catch {
    connectionString = configuredConnectionString;
  }

  if (!globalForDatabase.postgresClient) {
    globalForDatabase.postgresClient = postgres(connectionString, {
      max: 4,
      prepare: false,
      ssl: "require",
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }

  return globalForDatabase.postgresClient;
}

export function getDb() {
  return drizzle(getClient(), { schema });
}
