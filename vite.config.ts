import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { loadPlanPayload, openPlanDatabase, savePlanPayload } from "./scripts/plan-db.js";

const createPlanApiMiddleware = () => {
  return async (req: { method?: string; url?: string; on: (event: string, handler: (chunk: any) => void) => void }, res: any) => {
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

export default defineConfig({
  envDir: ".",
  plugins: [react()],
  configureServer(server) {
    server.middlewares.use("/api/plan", createPlanApiMiddleware());
  },
  configurePreviewServer(server) {
    server.middlewares.use("/api/plan", createPlanApiMiddleware());
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
