import { createClient } from "@libsql/client/web";
import { drizzle } from "drizzle-orm/libsql/web";
import * as schema from "./schema";

const url =
  process.env.TURSO_DATABASE_URL ||
  "libsql://devpulse-ritual-dev-git.aws-us-east-2.turso.io";
const authToken =
  process.env.TURSO_AUTH_TOKEN ||
  "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTU1MTk3MTgsImlkIjoiMDFhMjBkNDAtZTgwMS03ZGUzLWIwZWMtYmY1ZDg2Y2M0ODFhIiwia2lkIjoiOU4wNkFHUmNMNFk3M3l2amwtY3lWbHcwaEZmRk54MWxYTjlFazg4ekxfTSIsInJpZCI6IjZmZDg3MzMwLWRlMDAtNGQ5My1iZjdjLTQ5YThiM2Q0OTJhZSJ9.UgAZ7dtseiTzNEteBRaVh_N_P134-fF-bDQqgyYtYMN4reQ1W9jNCUfpEhkZwg45gdL1L2iz30TwBcH4y792Dg";

// Create the libSQL client
export const client = createClient({
  url,
  authToken,
});

// Export typed Drizzle instance
export const db = drizzle(client, { schema });
