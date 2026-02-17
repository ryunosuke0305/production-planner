import fs from "node:fs/promises";
import path from "node:path";

const dataDir = path.resolve(process.cwd(), "data");
export const AUTH_USERS_PATH = path.join(dataDir, "auth-users.json");

/**
 * @typedef {"admin" | "requester" | "viewer"} AuthRole
 */

/**
 * @typedef {{ id: string; name: string; role: AuthRole; password: string }} AuthUser
 */

/** @returns {Promise<AuthUser[]>} */
export const readAuthUsers = async () => {
  try {
    const raw = await fs.readFile(AUTH_USERS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.users)) {
      return [];
    }
    return parsed.users
      .filter((user) => user && typeof user === "object")
      .map((user) => ({
        id: typeof user.id === "string" ? user.id : "",
        name: typeof user.name === "string" ? user.name : "",
        role: user.role,
        password: typeof user.password === "string" ? user.password : "",
      }))
      .filter((user) => user.id && user.name && user.password);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

/** @param {AuthUser[]} users */
export const writeAuthUsers = async (users) => {
  await fs.mkdir(path.dirname(AUTH_USERS_PATH), { recursive: true });
  const payload = JSON.stringify({ users }, null, 2);
  await fs.writeFile(AUTH_USERS_PATH, payload, "utf-8");
};
