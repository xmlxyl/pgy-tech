import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

function run(command) {
  console.log(`> ${command}`);
  execSync(command, { stdio: "inherit", env: process.env });
}

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set. Cannot create database tables.");
  process.exit(1);
}

if (!process.env.DIRECT_DATABASE_URL) {
  process.env.DIRECT_DATABASE_URL =
    process.env.POSTGRES_URL_DATABASE_URL_UNPOOLED ||
    process.env.DATABASE_URL;
}

if (!process.env.DIRECT_DATABASE_URL) {
  console.error(
    "ERROR: Set DIRECT_DATABASE_URL, POSTGRES_URL_DATABASE_URL_UNPOOLED, or DATABASE_URL.",
  );
  process.exit(1);
}

const prismaClient = join(
  process.cwd(),
  "node_modules",
  ".prisma",
  "client",
  "index.js",
);

try {
  run("npx prisma generate");
} catch {
  if (existsSync(prismaClient)) {
    console.warn(
      "prisma generate skipped (file locked — stop `shopify app dev` and retry later). Continuing with migrate...",
    );
  } else {
    console.error(
      "prisma generate failed and client is missing. Stop `shopify app dev`, close terminals using this project, then run again.",
    );
    process.exit(1);
  }
}

try {
  run("npx prisma migrate deploy");
  console.log("Database migrations applied successfully.");
} catch {
  console.warn("migrate deploy failed — running prisma db push as fallback...");
  run("npx prisma db push --skip-generate");
  console.log("Database schema pushed successfully.");
}
