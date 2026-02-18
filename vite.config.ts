import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { GoogleGenAI } from "@google/genai";
import {
  ensurePlanDatabaseSeeded,
  loadDailyStocks,
  loadImportHeaderOverrides,
  loadPlanPayload,
  openPlanDatabase,
  saveDailyStocks,
  saveImportHeaderOverrides,
  savePlanPayload,
} from "./scripts/plan-db.js";
import { readAuthUsers, writeAuthUsers } from "./scripts/auth-user-db.js";

type MiddlewareRequest = {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: {
    remoteAddress?: string;
  };
  on: (event: string, handler: (chunk: any) => void) => void;
};

type MiddlewareResponse = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

type MiddlewareNext = (error?: unknown) => void;

type GeminiRequestPayload = {
  systemInstruction?: { role: "system"; parts: Array<{ text: string }> };
  contents?: Array<{ role: string; parts: Array<{ text: string }> }>;
  model?: string;
};

type ChatHistoryMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
};

type AuthRole = "admin" | "requester" | "viewer";


type AuthJwtPayload = {
  sub: string;
  name: string;
  role: AuthRole;
  iat: number;
  exp: number;
};

type AuditLogRecord = {
  timestamp: string;
  userId: string;
  role: AuthRole | "guest";
  ip: string;
  endpoint: string;
  method: string;
  result: string;
  targetId: string;
  requestId: string;
};

const CONSTRAINTS_PATH = fileURLToPath(new URL("./data/gemini-constraints.json", import.meta.url));
const CHAT_HISTORY_PATH = fileURLToPath(new URL("./data/gemini-chat.json", import.meta.url));
const AUDIT_LOG_PATH = fileURLToPath(new URL("./data/audit.log", import.meta.url));
const AUTH_SESSION_TTL_SECONDS = 60 * 60 * 12;

const readConstraintsText = async () => {
  try {
    const raw = await fs.readFile(CONSTRAINTS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { text?: string };
    return typeof parsed.text === "string" ? parsed.text : "";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
};

const writeConstraintsText = async (text: string) => {
  await fs.mkdir(path.dirname(CONSTRAINTS_PATH), { recursive: true });
  const payload = JSON.stringify({ text }, null, 2);
  await fs.writeFile(CONSTRAINTS_PATH, payload, "utf-8");
};

const readChatHistory = async (): Promise<ChatHistoryMessage[]> => {
  try {
    const raw = await fs.readFile(CHAT_HISTORY_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { messages?: ChatHistoryMessage[] };
    return Array.isArray(parsed.messages) ? parsed.messages : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const writeChatHistory = async (messages: ChatHistoryMessage[]) => {
  await fs.mkdir(path.dirname(CHAT_HISTORY_PATH), { recursive: true });
  const payload = JSON.stringify({ messages }, null, 2);
  await fs.writeFile(CHAT_HISTORY_PATH, payload, "utf-8");
};

const parseCookies = (cookieHeader?: string) => {
  if (!cookieHeader) return {};
  return cookieHeader.split(";").reduce<Record<string, string>>((acc, chunk) => {
    const [rawKey, ...rest] = chunk.trim().split("=");
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
};

const serializeCookie = (name: string, value: string, options: { maxAge?: number; secure?: boolean } = {}) => {
  const attrs = ["Path=/", "HttpOnly", "SameSite=Lax"];
  if (typeof options.maxAge === "number") {
    attrs.push(`Max-Age=${options.maxAge}`);
  }
  if (options.secure) {
    attrs.push("Secure");
  }
  return `${name}=${encodeURIComponent(value)}; ${attrs.join("; ")}`;
};

const getRequestCookie = (req: MiddlewareRequest, name: string) => {
  const cookieHeader = req.headers?.cookie;
  if (Array.isArray(cookieHeader)) {
    return parseCookies(cookieHeader.join("; "))[name];
  }
  return parseCookies(cookieHeader)[name];
};


const getHeaderValue = (req: MiddlewareRequest, name: string) => {
  const value = req.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
};

const getRequestPath = (req: MiddlewareRequest) => {
  try {
    return new URL(req.url ?? "", "http://localhost").pathname;
  } catch {
    return req.url ?? "";
  }
};

const resolveRequestId = (req: MiddlewareRequest) => {
  const headerValue = getHeaderValue(req, "x-request-id").trim();
  return headerValue || crypto.randomUUID();
};

const resolveRequestIp = (req: MiddlewareRequest) => {
  const forwardedFor = getHeaderValue(req, "x-forwarded-for")
    .split(",")
    .map((part) => part.trim())
    .find(Boolean);
  return forwardedFor || req.socket?.remoteAddress || "unknown";
};

const appendAuditLog = async (record: AuditLogRecord) => {
  await fs.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true });
  await fs.appendFile(AUDIT_LOG_PATH, `${JSON.stringify(record)}\n`, "utf-8");
};

const writeAuditLog = async (
  req: MiddlewareRequest,
  payload: {
    userId?: string;
    role?: AuthRole | "guest";
    result: string;
    targetId?: string;
    requestId?: string;
  }
) => {
  try {
    await appendAuditLog({
      timestamp: new Date().toISOString(),
      userId: payload.userId ?? "anonymous",
      role: payload.role ?? "guest",
      ip: resolveRequestIp(req),
      endpoint: getRequestPath(req),
      method: (req.method ?? "").toUpperCase(),
      result: payload.result,
      targetId: payload.targetId ?? "-",
      requestId: payload.requestId ?? resolveRequestId(req),
    });
  } catch (error) {
    console.error("Failed to write audit log:", error);
  }
};

const buildCsrfToken = (sessionToken: string, jwtSecret: string) =>
  crypto.createHmac("sha256", `${jwtSecret}:csrf`).update(sessionToken).digest("base64url");

const verifyCsrfToken = (sessionToken: string, csrfToken: string, jwtSecret: string) => {
  const expected = Buffer.from(buildCsrfToken(sessionToken, jwtSecret));
  const actual = Buffer.from(csrfToken);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
};

const isAuthRole = (value: string): value is AuthRole =>
  value === "admin" || value === "requester" || value === "viewer";

const base64UrlEncode = (value: string | Buffer) => Buffer.from(value).toString("base64url");

const base64UrlDecode = (value: string) => Buffer.from(value, "base64url").toString("utf-8");

const signJwt = (payload: AuthJwtPayload, secret: string) => {
  const header = { alg: "HS256", typ: "JWT" };
  const headerSegment = base64UrlEncode(JSON.stringify(header));
  const payloadSegment = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signature = crypto.createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
};

const verifyJwt = (token: string, secret: string): AuthJwtPayload | null => {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerSegment, payloadSegment, signature] = parts;
  try {
    const header = JSON.parse(base64UrlDecode(headerSegment)) as { alg?: string; typ?: string };
    if (header.alg !== "HS256") return null;
    const signingInput = `${headerSegment}.${payloadSegment}`;
    const expectedSignature = crypto.createHmac("sha256", secret).update(signingInput).digest("base64url");
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (signatureBuffer.length !== expectedBuffer.length) return null;
    if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;
    const payload = JSON.parse(base64UrlDecode(payloadSegment)) as Partial<AuthJwtPayload>;
    if (
      typeof payload.sub !== "string" ||
      typeof payload.name !== "string" ||
      typeof payload.role !== "string" ||
      !isAuthRole(payload.role) ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) return null;
    return payload as AuthJwtPayload;
  } catch {
    return null;
  }
};

const readRequestBody = (req: MiddlewareRequest) =>
  new Promise<string>((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: any) => {
      body += chunk.toString("utf-8");
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

const getAuthSession = async (req: MiddlewareRequest, jwtSecret: string) => {
  const token = getRequestCookie(req, "auth_session");
  if (!token) return null;
  const payload = verifyJwt(token, jwtSecret);
  if (!payload) return null;
  return {
    userId: payload.sub,
    name: payload.name,
    role: payload.role,
  };
};

const ensureAuthSession = async (req: MiddlewareRequest, res: MiddlewareResponse, jwtSecret: string) => {
  const session = await getAuthSession(req, jwtSecret);
  if (!session) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return null;
  }
  return session;
};

const isWriteMethod = (method?: string) => {
  const normalized = method?.toUpperCase();
  return normalized && normalized !== "GET" && normalized !== "HEAD";
};

const isProductionCookie = () => process.env.NODE_ENV === "production";

const resolveAuthJwtSecret = (env: Record<string, string | undefined>) => {
  const secret = (env.AUTH_JWT_SECRET ?? process.env.AUTH_JWT_SECRET ?? "").trim();
  if (!secret) {
    console.warn("AUTH_JWT_SECRET is not configured. Falling back to an insecure default for development.");
    return "dev-insecure-auth-secret";
  }
  return secret;
};

const createConstraintsApiMiddleware = () => {
  return async (req: MiddlewareRequest, res: MiddlewareResponse) => {
    if (req.method === "GET") {
      try {
        const text = await readConstraintsText();
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ text }));
      } catch (error) {
        console.error("Failed to read constraints:", error);
        res.statusCode = 500;
        res.end("Failed to read constraints.");
      }
      return;
    }

    if (req.method === "POST") {
            let body = "";
      req.on("data", (chunk: any) => {
        body += chunk.toString("utf-8");
      });
      req.on("end", async () => {
        let parsed: { text?: string };
        try {
          parsed = JSON.parse(body || "{}") as { text?: string };
        } catch {
          res.statusCode = 400;
          res.end("Invalid JSON payload.");
          return;
        }
        if (typeof parsed.text !== "string") {
          res.statusCode = 400;
          res.end("Invalid constraints payload.");
          return;
        }
        try {
          await writeConstraintsText(parsed.text);
          res.statusCode = 204;
          res.end();
        } catch (error) {
          console.error("Failed to save constraints:", error);
          res.statusCode = 500;
          res.end("Failed to save constraints.");
        }
      });
      return;
    }

    res.statusCode = 405;
    res.end("Method Not Allowed");
  };
};

const createChatHistoryApiMiddleware = () => {
  const isChatMessage = (value: any): value is ChatHistoryMessage => {
    if (!value || typeof value !== "object") return false;
    if (typeof value.id !== "string") return false;
    if (value.role !== "user" && value.role !== "assistant") return false;
    if (typeof value.content !== "string") return false;
    if (typeof value.createdAt !== "undefined" && typeof value.createdAt !== "string") return false;
    return true;
  };

  return async (req: MiddlewareRequest, res: MiddlewareResponse) => {
    if (req.method === "GET") {
      try {
        const messages = await readChatHistory();
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ messages }));
      } catch (error) {
        console.error("Failed to read chat history:", error);
        res.statusCode = 500;
        res.end("Failed to read chat history.");
      }
      return;
    }

    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk: any) => {
        body += chunk.toString("utf-8");
      });
      req.on("end", async () => {
        let parsed: { messages?: ChatHistoryMessage[] };
        try {
          parsed = JSON.parse(body || "{}") as { messages?: ChatHistoryMessage[] };
        } catch {
          res.statusCode = 400;
          res.end("Invalid JSON payload.");
          return;
        }
        if (!Array.isArray(parsed.messages) || !parsed.messages.every(isChatMessage)) {
          res.statusCode = 400;
          res.end("Invalid chat history payload.");
          return;
        }
        try {
          const current = await readChatHistory();
          const knownIds = new Set(current.map((message) => message.id));
          const merged = [...current];
          parsed.messages.forEach((message) => {
            if (knownIds.has(message.id)) return;
            knownIds.add(message.id);
            merged.push(message);
          });
          await writeChatHistory(merged);
          res.statusCode = 204;
          res.end();
        } catch (error) {
          console.error("Failed to save chat history:", error);
          res.statusCode = 500;
          res.end("Failed to save chat history.");
        }
      });
      return;
    }

    res.statusCode = 405;
    res.end("Method Not Allowed");
  };
};

const createAuthApiMiddleware = (jwtSecret: string) => {
  return async (req: MiddlewareRequest, res: MiddlewareResponse) => {
    const requestId = resolveRequestId(req);

    if (req.method === "GET") {
      if ((req.url ?? "").endsWith("/csrf")) {
        const session = await ensureAuthSession(req, res, jwtSecret);
        if (!session) {
          await writeAuditLog(req, { result: "auth.csrf.failed.401", requestId });
          return;
        }
        const sessionToken = getRequestCookie(req, "auth_session") ?? "";
        if (!sessionToken) {
          res.statusCode = 401;
          res.end();
          await writeAuditLog(req, {
            userId: session.userId,
            role: session.role,
            result: "auth.csrf.failed.401",
            requestId,
          });
          return;
        }
        const csrfToken = buildCsrfToken(sessionToken, jwtSecret);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ csrfToken }));
        return;
      }

      const session = await getAuthSession(req, jwtSecret);
      if (!session) {
        res.statusCode = 401;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          user: {
            id: session.userId,
            name: session.name,
            role: session.role,
          },
        })
      );
      return;
    }

    if (req.method === "POST") {
      if ((req.url ?? "").endsWith("/logout")) {
        const session = await getAuthSession(req, jwtSecret);
        res.statusCode = 204;
        res.setHeader("Set-Cookie", serializeCookie("auth_session", "", { maxAge: 0, secure: isProductionCookie() }));
        res.end();
        await writeAuditLog(req, {
          userId: session?.userId,
          role: session?.role,
          result: "auth.logout.success",
          requestId,
        });
        return;
      }

      let body = "";
      req.on("data", (chunk: any) => {
        body += chunk.toString("utf-8");
      });
      req.on("end", async () => {
        let parsed: { username?: string; password?: string };
        try {
          parsed = JSON.parse(body || "{}") as { username?: string; password?: string };
        } catch {
          res.statusCode = 400;
          res.end("Invalid JSON payload.");
          await writeAuditLog(req, { result: "auth.login.failed.400", requestId });
          return;
        }
        const username = typeof parsed.username === "string" ? parsed.username.trim() : "";
        const password = typeof parsed.password === "string" ? parsed.password : "";
        if (!username || !password) {
          res.statusCode = 400;
          res.end("Invalid login payload.");
          await writeAuditLog(req, { result: "auth.login.failed.400", requestId, targetId: username || "-" });
          return;
        }
        const users = await readAuthUsers();
        if (!users.length) {
          res.statusCode = 500;
          res.end("No auth users configured.");
          await writeAuditLog(req, { result: "auth.login.failed.500", requestId, targetId: username });
          return;
        }
        const user = users.find((entry) => entry.id === username);
        if (!user || password !== user.password) {
          res.statusCode = 401;
          res.end("Invalid credentials.");
          await writeAuditLog(req, { result: "auth.login.failed.401", requestId, targetId: username });
          return;
        }
        const now = Math.floor(Date.now() / 1000);
        const token = signJwt(
          {
            sub: user.id,
            name: user.name,
            role: user.role,
            iat: now,
            exp: now + AUTH_SESSION_TTL_SECONDS,
          },
          jwtSecret
        );
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.setHeader(
          "Set-Cookie",
          serializeCookie("auth_session", token, {
            secure: isProductionCookie(),
            maxAge: AUTH_SESSION_TTL_SECONDS,
          })
        );
        res.end(
          JSON.stringify({
            user: {
              id: user.id,
              name: user.name,
              role: user.role,
            },
          })
        );
        await writeAuditLog(req, {
          userId: user.id,
          role: user.role,
          result: "auth.login.success",
          targetId: user.id,
          requestId,
        });
      });
      return;
    }

    res.statusCode = 405;
    res.end("Method Not Allowed");
  };
};

const createAdminUsersApiMiddleware = (jwtSecret: string) => {
  return async (req: MiddlewareRequest, res: MiddlewareResponse) => {
    const requestId = resolveRequestId(req);
    const session = await ensureAuthSession(req, res, jwtSecret);
    if (!session) return;
    if (session.role !== "admin") {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Forbidden" }));
      await writeAuditLog(req, {
        userId: session.userId,
        role: session.role,
        result: "admin.users.failed.403",
        requestId,
      });
      return;
    }

    if (req.method === "GET") {
      try {
        const users = await readAuthUsers();
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ users: users.map(({ id, name, role }) => ({ id, name, role })) }));
      } catch (error) {
        console.error("Failed to read auth users:", error);
        res.statusCode = 500;
        res.end("Failed to read auth users.");
      }
      return;
    }

    if (req.method === "POST") {
      try {
        const body = await readRequestBody(req);
        const parsed = JSON.parse(body || "{}") as { id?: string; name?: string; role?: string; password?: string };
        const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
        const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
        const role = typeof parsed.role === "string" ? parsed.role.trim() : "";
        const password = typeof parsed.password === "string" ? parsed.password : "";
        if (!id || !name || !role || !password || !isAuthRole(role)) {
          res.statusCode = 400;
          res.end("Invalid user payload.");
          await writeAuditLog(req, {
            userId: session.userId,
            role: session.role,
            result: "admin.users.create.failed.400",
            requestId,
          });
          return;
        }
        const users = await readAuthUsers();
        if (users.some((user) => user.id === id)) {
          res.statusCode = 409;
          res.end("User ID already exists.");
          return;
        }
                users.push({ id, name, role, password });
        await writeAuthUsers(users);
        res.statusCode = 201;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ user: { id, name, role } }));
        await writeAuditLog(req, {
          userId: session.userId,
          role: session.role,
          result: "admin.users.create.success",
          targetId: id,
          requestId,
        });
      } catch (error) {
        console.error("Failed to create auth user:", error);
        res.statusCode = 400;
        res.end("Invalid JSON payload.");
      }
      return;
    }

    if (req.method === "PUT") {
      try {
        const body = await readRequestBody(req);
        const parsed = JSON.parse(body || "{}") as {
          id?: string;
          name?: string;
          role?: string;
          password?: string;
        };
        const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
        const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
        const role = typeof parsed.role === "string" ? parsed.role.trim() : "";
        const password = typeof parsed.password === "string" ? parsed.password : "";
        if (!id || !name || !role || !isAuthRole(role)) {
          res.statusCode = 400;
          res.end("Invalid user payload.");
          await writeAuditLog(req, {
            userId: session.userId,
            role: session.role,
            result: "admin.users.update.failed.400",
            requestId,
          });
          return;
        }
        const users = await readAuthUsers();
        const target = users.find((user) => user.id === id);
        if (!target) {
          res.statusCode = 404;
          res.end("User not found.");
          return;
        }
        target.name = name;
        target.role = role;
        if (password) {
          target.password = password;
        }
        await writeAuthUsers(users);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ user: { id, name, role } }));
        await writeAuditLog(req, {
          userId: session.userId,
          role: session.role,
          result: "admin.users.update.success",
          targetId: id,
          requestId,
        });
      } catch (error) {
        console.error("Failed to update auth user:", error);
        res.statusCode = 400;
        res.end("Invalid JSON payload.");
      }
      return;
    }

    if (req.method === "DELETE") {
      try {
        const body = await readRequestBody(req);
        const parsed = JSON.parse(body || "{}") as { id?: string };
        const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
        if (!id) {
          res.statusCode = 400;
          res.end("Invalid user payload.");
          await writeAuditLog(req, {
            userId: session.userId,
            role: session.role,
            result: "admin.users.delete.failed.400",
            requestId,
          });
          return;
        }
        const users = await readAuthUsers();
        const target = users.find((user) => user.id === id);
        if (!target) {
          res.statusCode = 404;
          res.end("User not found.");
          return;
        }
        if (target.role === "admin") {
          const remainingAdmins = users.filter((user) => user.role === "admin" && user.id !== id);
          if (!remainingAdmins.length) {
            res.statusCode = 409;
            res.end("At least one admin user is required.");
            return;
          }
        }
        const updatedUsers = users.filter((user) => user.id !== id);
        await writeAuthUsers(updatedUsers);
        res.statusCode = 204;
        res.end();
        await writeAuditLog(req, {
          userId: session.userId,
          role: session.role,
          result: "admin.users.delete.success",
          targetId: id,
          requestId,
        });
      } catch (error) {
        console.error("Failed to delete auth user:", error);
        res.statusCode = 400;
        res.end("Invalid JSON payload.");
      }
      return;
    }

    res.statusCode = 405;
    res.end("Method Not Allowed");
  };
};

const createAuthGuardMiddleware = (jwtSecret: string) => {
  return async (req: MiddlewareRequest, res: MiddlewareResponse, next: MiddlewareNext) => {
    if (!req.url?.startsWith("/api/")) {
      next();
      return;
    }
    if (req.url.startsWith("/api/auth")) {
      next();
      return;
    }
    const requestId = resolveRequestId(req);
    const session = await ensureAuthSession(req, res, jwtSecret);
    if (!session) {
      await writeAuditLog(req, { result: "auth.guard.failed.401", requestId });
      return;
    }
    if (isWriteMethod(req.method) && session.role !== "admin") {
      const canRequesterWrite =
        session.role === "requester" &&
        (req.url.startsWith("/api/plan") ||
          req.url.startsWith("/api/daily-stocks") ||
          req.url.startsWith("/api/import-headers"));
      if (!canRequesterWrite) {
        res.statusCode = 403;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Forbidden" }));
        await writeAuditLog(req, {
          userId: session.userId,
          role: session.role,
          result: "auth.guard.failed.403",
          requestId,
        });
        return;
      }
    }
    next();
  };
};

const createCsrfGuardMiddleware = (jwtSecret: string) => {
  return async (req: MiddlewareRequest, res: MiddlewareResponse, next: MiddlewareNext) => {
    if (!req.url?.startsWith("/api/")) {
      next();
      return;
    }
    if (!isWriteMethod(req.method)) {
      next();
      return;
    }
    if (req.url.startsWith("/api/gemini")) {
      next();
      return;
    }
    if (req.url.startsWith("/api/auth/login")) {
      next();
      return;
    }

    const requestId = resolveRequestId(req);
    const session = await getAuthSession(req, jwtSecret);
    const csrfToken = getHeaderValue(req, "x-csrf-token").trim();
    const sessionToken = getRequestCookie(req, "auth_session") ?? "";

    if (!session || !sessionToken || !csrfToken || !verifyCsrfToken(sessionToken, csrfToken, jwtSecret)) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "CSRF token is invalid." }));
      await writeAuditLog(req, {
        userId: session?.userId,
        role: session?.role,
        result: "csrf.failed.403",
        requestId,
      });
      return;
    }
    next();
  };
};

const createPlanApiMiddleware = (jwtSecret: string) => {
  return async (req: MiddlewareRequest, res: MiddlewareResponse) => {
    if (req.method === "GET") {
      const url = new URL(req.url ?? "", "http://localhost");
      const from = url.searchParams.get("from") ?? undefined;
      const to = url.searchParams.get("to") ?? undefined;
      const itemId = url.searchParams.get("itemId") ?? undefined;
      const itemName = url.searchParams.get("itemName") ?? undefined;
      let db;
      try {
        db = await openPlanDatabase();
        const payload = loadPlanPayload(db, { from, to, itemId, itemName });
        if (!payload) {
          res.statusCode = 204;
          res.end();
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(payload));
      } catch (error) {
        console.error("Failed to read plan data:", error);
        res.statusCode = 500;
        res.end("Failed to read plan data.");
      } finally {
        db?.close();
      }
      return;
    }

    if (req.method === "POST") {
      const requestId = resolveRequestId(req);
      const session = await getAuthSession(req, jwtSecret);
      let body = "";
      req.on("data", (chunk: any) => {
        body += chunk.toString("utf-8");
      });
      req.on("end", async () => {
        let db;
        try {
          const parsed = JSON.parse(body || "{}");
          db = await openPlanDatabase();
          savePlanPayload(db, parsed);
          res.statusCode = 204;
          res.end();
          await writeAuditLog(req, {
            userId: session?.userId,
            role: session?.role,
            result: "plan.save.success",
            requestId,
          });
        } catch {
          res.statusCode = 400;
          res.end("Invalid JSON payload.");
          await writeAuditLog(req, {
            userId: session?.userId,
            role: session?.role,
            result: "plan.save.failed.400",
            requestId,
          });
        } finally {
          db?.close();
        }
      });
      return;
    }

    res.statusCode = 405;
    res.end("Method Not Allowed");
  };
};

const createDailyStocksApiMiddleware = (jwtSecret: string) => {
  return async (req: MiddlewareRequest, res: MiddlewareResponse) => {
    if (req.method === "GET") {
      let db;
      try {
        db = await openPlanDatabase();
        const payload = loadDailyStocks(db);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(payload));
      } catch (error) {
        console.error("Failed to read daily stocks:", error);
        res.statusCode = 500;
        res.end("Failed to read daily stocks.");
      } finally {
        db?.close();
      }
      return;
    }

    if (req.method === "POST") {
      const requestId = resolveRequestId(req);
      const session = await getAuthSession(req, jwtSecret);
      let body = "";
      req.on("data", (chunk: any) => {
        body += chunk.toString("utf-8");
      });
      req.on("end", async () => {
        let parsed: { entries?: unknown };
        try {
          parsed = JSON.parse(body || "{}") as { entries?: unknown };
        } catch {
          res.statusCode = 400;
          res.end("Invalid JSON payload.");
          return;
        }
        const entries = Array.isArray(parsed.entries) ? parsed.entries : null;
        if (!entries) {
          res.statusCode = 400;
          res.end("Invalid daily stocks payload.");
          await writeAuditLog(req, {
            userId: session?.userId,
            role: session?.role,
            result: "dailyStocks.save.failed.400",
            requestId,
          });
          return;
        }
        let db;
        try {
          db = await openPlanDatabase();
          const updatedAtISO = saveDailyStocks(db, entries);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ updatedAtISO }));
          await writeAuditLog(req, {
            userId: session?.userId,
            role: session?.role,
            result: "dailyStocks.save.success",
            requestId,
          });
        } catch (error) {
          console.error("Failed to save daily stocks:", error);
          res.statusCode = 500;
          res.end("Failed to save daily stocks.");
        } finally {
          db?.close();
        }
      });
      return;
    }

    res.statusCode = 405;
    res.end("Method Not Allowed");
  };
};

const createImportHeadersApiMiddleware = () => {
  return async (req: MiddlewareRequest, res: MiddlewareResponse) => {
    if (req.method === "GET") {
      let db;
      try {
        db = await openPlanDatabase();
        const payload = loadImportHeaderOverrides(db);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(payload));
      } catch (error) {
        console.error("Failed to read import headers:", error);
        res.statusCode = 500;
        res.end("Failed to read import headers.");
      } finally {
        db?.close();
      }
      return;
    }

    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk: any) => {
        body += chunk.toString("utf-8");
      });
      req.on("end", async () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(body || "{}");
        } catch {
          res.statusCode = 400;
          res.end("Invalid JSON payload.");
          return;
        }
        let db;
        try {
          db = await openPlanDatabase();
          const saved = saveImportHeaderOverrides(db, parsed);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(saved));
        } catch (error) {
          console.error("Failed to save import headers:", error);
          res.statusCode = 500;
          res.end("Failed to save import headers.");
        } finally {
          db?.close();
        }
      });
      return;
    }

    res.statusCode = 405;
    res.end("Method Not Allowed");
  };
};


const isTruthyEnv = (value: string | undefined) => {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

const createGeminiProxyMiddleware = (env: { GEMINI_API_KEY?: string; GEMINI_MODEL?: string }) => {
  let isBusy = false;
  return async (req: MiddlewareRequest, res: MiddlewareResponse) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("Method Not Allowed");
      return;
    }

    if (isBusy) {
      res.statusCode = 409;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          message: "現在別の指示を処理しています。処理結果を確認後に再度実行してください。",
        })
      );
      return;
    }

    const apiKey = (env.GEMINI_API_KEY ?? "").trim();
    if (!apiKey) {
      res.statusCode = 401;
      res.end("GEMINI_API_KEY is not configured.");
      return;
    }

    const ai = new GoogleGenAI({ apiKey });
    isBusy = true;

    let body = "";
    req.on("data", (chunk: any) => {
      body += chunk.toString("utf-8");
    });
    req.on("end", async () => {
      try {
        let parsed: GeminiRequestPayload;
        try {
          parsed = JSON.parse(body || "{}") as GeminiRequestPayload;
        } catch {
          res.statusCode = 400;
          res.end("Invalid JSON payload.");
          return;
        }

        try {
          const model = (parsed.model ?? env.GEMINI_MODEL ?? "gemini-2.5-flash").trim();
          const systemInstructionText =
            parsed.systemInstruction?.parts
              ?.map((part) => part.text)
              .filter((text) => text && text.trim())
              .join("\n")
              .trim() || undefined;

          const response = await ai.models.generateContent({
            model,
            contents: parsed.contents ?? [],
            config: systemInstructionText ? { systemInstruction: systemInstructionText } : undefined,
          });

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(response));
        } catch (error) {
          console.error("Gemini SDK error:", error);
          res.statusCode = 502;
          res.end("Gemini upstream error.");
        }
      } finally {
        isBusy = false;
      }
    });
    req.on("error", () => {
      isBusy = false;
      res.statusCode = 400;
      res.end("Invalid JSON payload.");
    });
  };
};

export default defineConfig(({ mode }) => {
  const envDir = "data";
  const env = loadEnv(mode, envDir, "");
  const authJwtSecret = resolveAuthJwtSecret(env);
  const exposeToLocalNetwork = isTruthyEnv(env.VITE_EXPOSE_LOCAL_NETWORK);
  return {
    envDir,
    plugins: [
      react(),
      {
        name: "plan-and-gemini-api",
        async configureServer(server) {
          await ensurePlanDatabaseSeeded();
          server.middlewares.use(createAuthGuardMiddleware(authJwtSecret));
          server.middlewares.use(createCsrfGuardMiddleware(authJwtSecret));
          server.middlewares.use("/api/auth", createAuthApiMiddleware(authJwtSecret));
          server.middlewares.use("/api/admin/users", createAdminUsersApiMiddleware(authJwtSecret));
          server.middlewares.use("/api/plan", createPlanApiMiddleware(authJwtSecret));
          server.middlewares.use("/api/daily-stocks", createDailyStocksApiMiddleware(authJwtSecret));
          server.middlewares.use("/api/import-headers", createImportHeadersApiMiddleware());
          server.middlewares.use("/api/constraints", createConstraintsApiMiddleware());
          server.middlewares.use("/api/chat", createChatHistoryApiMiddleware());
          server.middlewares.use("/api/gemini", createGeminiProxyMiddleware(env));
        },
        async configurePreviewServer(server) {
          await ensurePlanDatabaseSeeded();
          server.middlewares.use(createAuthGuardMiddleware(authJwtSecret));
          server.middlewares.use(createCsrfGuardMiddleware(authJwtSecret));
          server.middlewares.use("/api/auth", createAuthApiMiddleware(authJwtSecret));
          server.middlewares.use("/api/admin/users", createAdminUsersApiMiddleware(authJwtSecret));
          server.middlewares.use("/api/plan", createPlanApiMiddleware(authJwtSecret));
          server.middlewares.use("/api/daily-stocks", createDailyStocksApiMiddleware(authJwtSecret));
          server.middlewares.use("/api/import-headers", createImportHeadersApiMiddleware());
          server.middlewares.use("/api/constraints", createConstraintsApiMiddleware());
          server.middlewares.use("/api/chat", createChatHistoryApiMiddleware());
          server.middlewares.use("/api/gemini", createGeminiProxyMiddleware(env));
        },
      },
    ],
    server: {
      host: exposeToLocalNetwork ? "0.0.0.0" : "127.0.0.1",
    },
    preview: {
      host: exposeToLocalNetwork ? "0.0.0.0" : "127.0.0.1",
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  };
});
