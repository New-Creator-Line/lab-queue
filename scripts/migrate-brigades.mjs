import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const envPath = path.resolve(process.cwd(), ".env.local");
let databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("DATABASE_URL=")) {
      databaseUrl = trimmed.slice("DATABASE_URL=".length).replace(/^["']|["']$/g, "");
      break;
    }
  }
}

if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

// Convert direct Supabase pooler if needed as in db/index.ts
let connectionString = databaseUrl;
try {
  const connectionUrl = new URL(databaseUrl);
  const directMatch = connectionUrl.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/);
  if (directMatch) {
    const projectRef = directMatch[1];
    connectionUrl.hostname = "aws-1-eu-central-1.pooler.supabase.com";
    connectionUrl.port = "6543";
    if (!connectionUrl.username.includes(".")) {
      connectionUrl.username = `postgres.${projectRef}`;
    }
    connectionUrl.searchParams.set("sslmode", "require");
    connectionString = connectionUrl.toString();
  }
} catch {
  // ignore URL parse errors
}

const sql = postgres(connectionString, {
  max: 1,
  ssl: "require",
  idle_timeout: 5,
  connect_timeout: 10,
});

async function run() {
  console.log("Applying brigade migration...");
  const migrationPath = path.resolve(process.cwd(), "supabase/migrations/20261027_brigades.sql");
  const migrationSql = fs.readFileSync(migrationPath, "utf-8");

  await sql.unsafe(migrationSql);
  console.log("Migration applied successfully!");
  await sql.end();
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
