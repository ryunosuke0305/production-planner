import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { GoogleGenAI } from "@google/genai";
import { loadPlanPayload, openPlanDatabase, savePlanPayload } from "./scripts/plan-db.js";

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

const createGeminiProxyMiddleware = (env: { GEMINI_API_KEY?: string; GEMINI_MODEL?: string }) => {
  return async (req: MiddlewareRequest, res: MiddlewareResponse) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("Method Not Allowed");
      return;
    }

    const apiKey = (env.GEMINI_API_KEY ?? "").trim();
    if (!apiKey) {
      res.statusCode = 401;
      res.end("GEMINI_API_KEY is not configured.");
      return;
    }

    const ai = new GoogleGenAI({ apiKey });

    let body = "";
    req.on("data", (chunk: any) => {
      body += chunk.toString("utf-8");
    });
    req.on("end", async () => {
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
    });
    req.on("error", () => {
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
          server.middlewares.use("/api/gemini", createGeminiProxyMiddleware(env));
        },
        configurePreviewServer(server) {
          server.middlewares.use("/api/plan", createPlanApiMiddleware());
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
