import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

dotenv.config({ path: process.env.ENV_FILE ?? "../.env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
