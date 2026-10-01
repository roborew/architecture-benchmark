// drizzle.config.ts
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./drizzle/schema.ts", // temporary; will be created by pull
  dbCredentials: {
    url: process.env.POSTGRES_URL!,
  },
  introspect: {
    casing: "camel", // or "preserve" if you prefer
  },
});
