import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Config } from "../config.js";
import type { Detector } from "../detector/index.js";
import type { Translator } from "../translator/index.js";
import { transformRequest, type MessagesRequestBody } from "../transform/messages.js";
import { logger } from "../utils/logger.js";

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function isMessagesEndpoint(url: string): boolean {
  return url.startsWith("/v1/messages");
}

function forwardRequest(
  upstreamUrl: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  body: Buffer | null,
  res: ServerResponse,
): void {
  const url = new URL(path, upstreamUrl);
  const isHttps = url.protocol === "https:";
  const requestFn = isHttps ? httpsRequest : httpRequest;

  const filteredHeaders = { ...headers };
  delete filteredHeaders["host"];
  // Remove transfer-encoding since we send a complete body
  delete filteredHeaders["transfer-encoding"];

  // If OAuth Bearer token is present, add the beta header so api.anthropic.com accepts it
  const authHeader = filteredHeaders["authorization"] ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const existing = filteredHeaders["anthropic-beta"] ?? "";
    const betaFlag = "oauth-2025-04-20";
    if (!existing.includes(betaFlag)) {
      filteredHeaders["anthropic-beta"] = existing
        ? `${existing},${betaFlag}`
        : betaFlag;
    }
  }
  if (body) {
    filteredHeaders["content-length"] = String(body.length);
  }

  const proxyReq = requestFn(
    url,
    {
      method,
      headers: filteredHeaders,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => {
    logger.error(`Upstream request error: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ error: { type: "proxy_error", message: err.message } }));
  });

  if (body) {
    proxyReq.end(body);
  } else {
    proxyReq.end();
  }
}

export function createHttpProxy(
  config: Config,
  detector: Detector,
  translator: Translator,
) {
  const server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";

    logger.info(`${method} ${url}`);

    // Only transform POST /v1/messages* requests
    if (method === "POST" && isMessagesEndpoint(url)) {
      try {
        const rawBody = await readBody(req);
        const body = JSON.parse(rawBody.toString()) as MessagesRequestBody;

        const transformed = await transformRequest(
          body,
          detector,
          translator,
          config.targetLang,
        );

        const transformedBody = Buffer.from(JSON.stringify(transformed));

        logger.info(`Translated request body: ${rawBody.length} -> ${transformedBody.length} bytes`);

        forwardRequest(
          config.upstreamUrl,
          method,
          url,
          req.headers as Record<string, string>,
          transformedBody,
          res,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        logger.error(`Transform error: ${message}`);

        // On transform error, forward original request
        const rawBody = await readBody(req).catch(() => Buffer.alloc(0));
        forwardRequest(
          config.upstreamUrl,
          method,
          url,
          req.headers as Record<string, string>,
          rawBody.length > 0 ? rawBody : null,
          res,
        );
      }
    } else {
      // Pass through non-messages requests
      const rawBody = method !== "GET" && method !== "HEAD" ? await readBody(req) : null;
      forwardRequest(
        config.upstreamUrl,
        method,
        url,
        req.headers as Record<string, string>,
        rawBody,
        res,
      );
    }
  });

  return {
    start(): Promise<void> {
      return new Promise((resolve) => {
        server.listen(config.proxyPort, () => {
          console.log(`\nmercury v0.2.0 — Translation proxy for Claude Code`);
          console.log(`Listening on http://localhost:${config.proxyPort}`);
          console.log(`\nConnect Claude Code:`);
          console.log(`  ANTHROPIC_BASE_URL=http://localhost:${config.proxyPort} claude\n`);
          logger.info(`Upstream: ${config.upstreamUrl}`);
          logger.info(`Target language: ${config.targetLang}`);
          logger.info(`Backend: ${config.backend}`);
          resolve();
        });
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
    server,
  };
}
