import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { gateway } from "./server/gateway";
function localGateway(env: Record<string, string>): Plugin {
  return {
    name: "local-wcl-gateway",
    configureServer(server) {
      server.middlewares.use("/api/wcl", async (req, res) => {
        const controller = new AbortController();
        res.on("close", () => controller.abort());
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 16384) {
              res.writeHead(413);
              res.end();
              return;
            }
            chunks.push(chunk);
          }
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers))
            if (v) headers.set(k, Array.isArray(v) ? v.join(",") : v);
          const request = new Request(
            `http://${req.headers.host}/api/wcl${req.url}`,
            {
              method: req.method,
              headers,
              body: ["GET", "HEAD"].includes(req.method ?? "GET")
                ? undefined
                : Buffer.concat(chunks),
              signal: controller.signal,
            },
          );
          const response = await gateway(request, env);
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch {
          res.writeHead(500, { "Cache-Control": "no-store" });
          res.end(JSON.stringify({ error: { message: "本地网关失败。" } }));
        }
      });
    },
  };
}
export default defineConfig(({ mode }) => ({
  plugins: [react(), localGateway(loadEnv(mode, process.cwd(), ""))],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  test: { include: ["tests/unit/**/*.test.ts"] },
}));
