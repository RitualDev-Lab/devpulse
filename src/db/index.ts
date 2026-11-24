import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const url = process.env.TURSO_DATABASE_URL || "file:local.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

// Create the libSQL client
export const client = createClient({
  url,
  authToken,
});

// Export typed Drizzle instance
export const db = drizzle(client, { schema });
