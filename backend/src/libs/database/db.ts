import { SQL } from "bun";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema";

const client = new SQL(
  "postgresql://postgres.crqbazcsrncvbnapuxcp:crqbazcsrncvbnapuxcp@aws-1-us-east-1.pooler.supabase.com:5432/postgres"
);
export const db = drizzle({ client, schema });

function snakeToCamelCase(str: string): string
{
  return str.replace(/([-_][a-z])/g, (group) =>
    group.toUpperCase().replace("-", "").replace("_", "")
  );
}

/**
 * Recursively converts the keys of an object (and its nested objects/arrays) from snake_case to camelCase.
 * @param obj The object or array to convert.
 * @returns A new object or array with camelCase keys.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function snakeToCamelCaseObject(obj: any): any
{
  if (Array.isArray(obj)) {
    return obj.map((v) => snakeToCamelCaseObject(v));
  } else if (
    obj !== null &&
    typeof obj === "object" &&
    !(obj instanceof Date)
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newObj: { [key: string]: any } = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const newKey = snakeToCamelCase(key);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        newObj[newKey] = snakeToCamelCaseObject((obj as any)[key]);
      }
    }
    return newObj;
  }
  return obj;
}

export async function findFirstUserNative(userId: string)
{
  try {
    const result = await client`
      SELECT *
      FROM "user"
      WHERE "id" = ${userId}
      LIMIT 1
    `;
    const row = result.length > 0 ? result[0] : null;
    return row ? snakeToCamelCaseObject(row) : null; // Convert keys before returning
  } catch (error) {
    console.error("Error fetching user natively:", error);
    return null;
  }
}

export async function selectUserBalanceNative(userId: string)
{
  try {
    const result = await client`
      SELECT *
      FROM "user_balances"
      WHERE "user_id" = ${userId}
      LIMIT 1
    `;
    const row = result.length > 0 ? result[0] : null;
    return row ? snakeToCamelCaseObject(row) : null; // Convert keys before returning
  } catch (error) {
    console.error("Error fetching user balance natively:", error);
    return null;
  }
}

export async function findFirstGameNative(gameId: string)
{
  try {
    const result = await client`
      SELECT *
      FROM "games"
      WHERE "id" = ${gameId}
      LIMIT 1
    `;
    const row = result.length > 0 ? result[0] : null;
    return row ? snakeToCamelCaseObject(row) : null; // Convert keys before returning
  } catch (error) {
    console.error("Error fetching game natively:", error);
    return null;
  }
}

export async function findFirstActiveGameSessionNative(
  userId: string,
  gameId: string
)
{
  try {
    const result = await client`
      SELECT *
      FROM "game_sessions"
      WHERE "user_id" = ${userId}
        AND "status" = 'ACTIVE'
        AND "game_id" = ${gameId}
      LIMIT 1
    `;
    const row = result.length > 0 ? result[0] : null;
    return row ? snakeToCamelCaseObject(row) : null; // Convert keys before returning
  } catch (error) {
    console.error("Error fetching active game session natively:", error);
    return null;
  }
}

const prepared = db.query.userTable.findMany({
  where: ((userTable, { eq }) => eq(userTable.id, sql.placeholder('id'))),
  with: {
    balance: true
    // where: ((userTable, { eq }) => eq(userTable.id, placeholder('pid'))),
    // },
  },
}).prepare('query_name');

/**
 * Recursively removes all fields with null values from an object.
 * @param obj The object to clean.
 * @returns A new object without null-valued fields.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function removeNullValues(obj: any): any
{
  if (obj === null || typeof obj !== 'object' || obj instanceof Date) {
    return obj;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cleaned: { [key: string]: any } = {};

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];

      if (value !== null) {
        if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
          // Recursively clean nested objects (but not Date objects)
          cleaned[key] = removeNullValues(value);
        } else {
          cleaned[key] = value;
        }
      }
    }
  }

  return cleaned;
}

export async function getUserWithBalance(id: string)
{
  try {
    const result = await prepared.execute({ id });
    const user = result[0];

    // Remove all fields with null values, including from nested objects like balance
    if (user) {
      return removeNullValues(user);
    }

    return null;
  } catch (error) {
    console.error("Error fetching user with balance natively:", error);
    return null;
  }
}
