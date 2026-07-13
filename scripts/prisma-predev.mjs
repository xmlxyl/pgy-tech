import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { config, parse } from "dotenv";

// Load .env and prefer file values for DB URLs (Shopify CLI may inject invalid placeholders).
config();
const fileEnv = parse(readFileSync(".env", "utf8"));
for (const key of [
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "POSTGRES_URL_DATABASE_URL_UNPOOLED",
]) {
  if (fileEnv[key]) process.env[key] = fileEnv[key];
}

function ensureDirectDatabaseUrl() {
  if (process.env.DIRECT_DATABASE_URL) return;

  process.env.DIRECT_DATABASE_URL =
    process.env.POSTGRES_URL_DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
}

function run(command, { required = true } = {}) {
  console.log(`> ${command}`);
  try {
    execSync(command, { stdio: "inherit", env: process.env });
  } catch (error) {
    if (required) throw error;

    console.warn(
      `WARNING: ${command} failed, continuing app dev with the existing database schema.`,
    );
  }
}

ensureDirectDatabaseUrl();

if (!process.env.DIRECT_DATABASE_URL) {
  console.error(
    "ERROR: Set DIRECT_DATABASE_URL, POSTGRES_URL_DATABASE_URL_UNPOOLED, or DATABASE_URL in .env",
  );
  process.exit(1);
}

run("npx prisma generate");
run("npx prisma db push", { required: false });
