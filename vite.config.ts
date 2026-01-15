import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
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

    let body = "";
    req.on("data", (chunk: any) => {
      body += chunk.toString("utf-8");
    });
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body || "{}") as GeminiRequestPayload;
        const model = (parsed.model ?? env.GEMINI_MODEL ?? "gemini-2.5-flash").trim();

        const upstream = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(
            apiKey
          )}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: parsed.systemInstruction,
              contents: parsed.contents,
            }),
          }
        );

        const responseText = await upstream.text();
        if (!upstream.ok) {
          console.error("Gemini upstream error:", {
            status: upstream.status,
            statusText: upstream.statusText,
            url: upstream.url,
            responseLength: responseText.length,
          });
        }
        res.statusCode = upstream.status;
        res.setHeader("Content-Type", upstream.headers.get("Content-Type") ?? "application/json");
        res.end(responseText);
      } catch {
        res.statusCode = 400;
        res.end("Invalid JSON payload.");
      }
    });
  };
};

export default defineConfig(({ mode }) => {
  const envDir = "data";
  const env = loadEnv(mode, envDir, "");
  return {
    envDir,
    plugins: [react()],
    configureServer(server) {
      server.middlewares.use("/api/plan", createPlanApiMiddleware());
      server.middlewares.use("/api/gemini", createGeminiProxyMiddleware(env));
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/plan", createPlanApiMiddleware());
      server.middlewares.use("/api/gemini", createGeminiProxyMiddleware(env));
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  };
});
