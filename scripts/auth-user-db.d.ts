export type AuthRole = "admin" | "requester" | "viewer";

export type AuthUser = {
  id: string;
  name: string;
  role: AuthRole;
  password: string;
};

export const AUTH_USERS_PATH: string;
export function readAuthUsers(): Promise<AuthUser[]>;
export function writeAuthUsers(users: AuthUser[]): Promise<void>;
