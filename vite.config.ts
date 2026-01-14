import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs/promises";
import path from "node:path";

const dataDir = path.resolve(__dirname, "data");
const planFilePath = path.join(dataDir, "plan.json");

const createPlanApiMiddleware = () => {
  return async (req: { method?: string; on: (event: string, handler: (chunk: any) => void) => void }, res: any) => {
    if (req.method === "GET") {
      try {
        const raw = await fs.readFile(planFilePath, "utf-8");
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(raw);
      } catch (error: any) {
        if (error?.code === "ENOENT") {
          res.statusCode = 204;
          res.end();
          return;
        }
        res.statusCode = 500;
        res.end("Failed to read plan data.");
      }
      return;
    }

    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk: any) => {
        body += chunk.toString("utf-8");
      });
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body || "{}");
          await fs.mkdir(dataDir, { recursive: true });
          await fs.writeFile(planFilePath, JSON.stringify(parsed, null, 2), "utf-8");
          res.statusCode = 204;
          res.end();
        } catch {
          res.statusCode = 400;
          res.end("Invalid JSON payload.");
        }
      });
      return;
    }

    res.statusCode = 405;
    res.end("Method Not Allowed");
  };
};

export default defineConfig({
  envDir: "data",
  plugins: [react()],
  configureServer(server) {
    server.middlewares.use("/api/plan", createPlanApiMiddleware());
  },
  configurePreviewServer(server) {
    server.middlewares.use("/api/plan", createPlanApiMiddleware());
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
