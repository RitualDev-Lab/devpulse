import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const url =
  process.env.TURSO_DATABASE_URL ||
  "libsql://devpulse-ritual-dev-git.aws-us-east-2.turso.io";
const authToken =
  process.env.TURSO_AUTH_TOKEN ||
  "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI2dmpxeGVmM0VmR1Z2dllERWJoUkd3Iiwib3JnX2lkIjoxMDAwMzEzMzM2fQ.Dyxg_8l1Xt5I6LvFVk-jvdyJJKm9qSXdEQ2qhtGZocGJZ343EizeBuA30N_LfSDU6VvzhJbJ-9hp4NcJb_2wCg";

// Create the libSQL client
export const client = createClient({
  url,
  authToken,
});

// Export typed Drizzle instance
export const db = drizzle(client, { schema });
