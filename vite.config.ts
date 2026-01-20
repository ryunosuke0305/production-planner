import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { GoogleGenAI } from "@google/genai";
import {
  loadDailyStocks,
  loadImportHeaderOverrides,
  loadOrders,
  loadPlanPayload,
  openPlanDatabase,
  saveDailyStocks,
  saveImportHeaderOverrides,
  saveOrders,
  savePlanPayload,
} from "./scripts/plan-db.js";

type MiddlewareRequest = {
  method?: string;
  url?: string;
  on: (event: string, handler: (chunk: any) => void) => void;
};

type MiddlewareResponse = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

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

const CONSTRAINTS_PATH = fileURLToPath(new URL("./data/gemini-constraints.json", import.meta.url));
const CHAT_HISTORY_PATH = fileURLToPath(new URL("./data/gemini-chat.json", import.meta.url));

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

const createPlanApiMiddleware = () => {
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
        } catch {
          res.statusCode = 400;
          res.end("Invalid JSON payload.");
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

const createDailyStocksApiMiddleware = () => {
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
          return;
        }
        let db;
        try {
          db = await openPlanDatabase();
          const updatedAtISO = saveDailyStocks(db, entries);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ updatedAtISO }));
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

const createOrdersApiMiddleware = () => {
  return async (req: MiddlewareRequest, res: MiddlewareResponse) => {
    if (req.method === "GET") {
      let db;
      try {
        db = await openPlanDatabase();
        const payload = loadOrders(db);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(payload));
      } catch (error) {
        console.error("Failed to read orders:", error);
        res.statusCode = 500;
        res.end("Failed to read orders.");
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
          res.end("Invalid orders payload.");
          return;
        }
        let db;
        try {
          db = await openPlanDatabase();
          const updatedAtISO = saveOrders(db, entries);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ updatedAtISO }));
        } catch (error) {
          console.error("Failed to save orders:", error);
          res.statusCode = 500;
          res.end("Failed to save orders.");
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
  return {
    envDir,
    plugins: [
      react(),
      {
        name: "plan-and-gemini-api",
        configureServer(server) {
          server.middlewares.use("/api/plan", createPlanApiMiddleware());
          server.middlewares.use("/api/daily-stocks", createDailyStocksApiMiddleware());
          server.middlewares.use("/api/orders", createOrdersApiMiddleware());
          server.middlewares.use("/api/import-headers", createImportHeadersApiMiddleware());
          server.middlewares.use("/api/constraints", createConstraintsApiMiddleware());
          server.middlewares.use("/api/chat", createChatHistoryApiMiddleware());
          server.middlewares.use("/api/gemini", createGeminiProxyMiddleware(env));
        },
        configurePreviewServer(server) {
          server.middlewares.use("/api/plan", createPlanApiMiddleware());
          server.middlewares.use("/api/daily-stocks", createDailyStocksApiMiddleware());
          server.middlewares.use("/api/orders", createOrdersApiMiddleware());
          server.middlewares.use("/api/import-headers", createImportHeadersApiMiddleware());
          server.middlewares.use("/api/constraints", createConstraintsApiMiddleware());
          server.middlewares.use("/api/chat", createChatHistoryApiMiddleware());
          server.middlewares.use("/api/gemini", createGeminiProxyMiddleware(env));
        },
      },
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  };
});
