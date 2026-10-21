import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  // Ignora tabelas/views do PostGIS (geography_columns etc.) — sem isso o
  // `db:push` tenta dropá-las e falha/pede confirmação interativa.
  extensionsFilters: ["postgis"],
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
