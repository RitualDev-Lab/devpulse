import { createClient } from "@libsql/client/web";
import { drizzle } from "drizzle-orm/libsql/web";
import * as schema from "./schema";

const url = process.env.TURSO_DATABASE_URL?.trim();
const authToken = process.env.TURSO_AUTH_TOKEN?.trim();

if (!url) {
  throw new Error("TURSO_DATABASE_URL environment variable is required.");
}

if (!authToken) {
  throw new Error("TURSO_AUTH_TOKEN environment variable is required.");
}

// Create the libSQL client
export const client = createClient({
  url,
  authToken,
});

// Export typed Drizzle instance
export const db = drizzle(client, { schema });
