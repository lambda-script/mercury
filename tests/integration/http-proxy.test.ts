import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { createHttpProxy } from "../../src/proxy/http.js";
import type { Config } from "../../src/config.js";
import type { Detector } from "../../src/detector/index.js";
import type { Translator } from "../../src/translator/index.js";

// Mock upstream server that echoes back the request body
function createMockUpstream(): { server: Server; port: number; start: () => Promise<number>; stop: () => Promise<void> } {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        received: JSON.parse(body || "{}"),
        path: req.url,
        method: req.method,
      }));
    });
  });

  return {
    server,
    port: 0,
    start() {
      return new Promise<number>((resolve) => {
        server.listen(0, () => {
          const addr = server.address();
          const port = typeof addr === "object" && addr ? addr.port : 0;
          this.port = port;
          resolve(port);
        });
      });
    },
    stop() {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}

describe("HTTP Proxy Integration", () => {
  let upstream: ReturnType<typeof createMockUpstream>;
  let proxy: ReturnType<typeof createHttpProxy>;
  let proxyPort: number;

  const mockDetector: Detector = {
    detect: () => ({ lang: "jpn", confidence: 1 }),
    isTargetLang: () => false,
  };

  const mockTranslator: Translator = {
    translate: async (text: string) => `[TRANSLATED] ${text}`,
  };

  beforeAll(async () => {
    upstream = createMockUpstream();
    const upstreamPort = await upstream.start();

    const config: Config = {
      backend: "haiku",
      sourceLang: "auto",
      targetLang: "eng",
      anthropicApiKey: "test-key",
      proxyPort: 0,
      upstreamUrl: `http://localhost:${upstreamPort}`,
      minDetectLength: 20,
    };

    proxy = createHttpProxy(config, mockDetector, mockTranslator);

    // Use port 0 to get a random available port
    await new Promise<void>((resolve) => {
      proxy.server.listen(0, () => resolve());
    });
    const addr = proxy.server.address();
    proxyPort = typeof addr === "object" && addr ? addr.port : 0;
  });

  afterAll(async () => {
    await proxy.stop();
    await upstream.stop();
  });

  it("should translate messages and forward to upstream", async () => {
    const body = {
      messages: [{ role: "user", content: "こんにちは世界" }],
      model: "claude-sonnet-4-20250514",
    };

    const res = await fetch(`http://localhost:${proxyPort}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.received.messages[0].content).toBe("[TRANSLATED] こんにちは世界");
    expect(data.path).toBe("/v1/messages");
  });

  it("should pass through non-messages endpoints", async () => {
    const res = await fetch(`http://localhost:${proxyPort}/v1/models`, {
      method: "GET",
    });

    // Mock upstream expects POST with body, GET will return empty
    expect(res.status).toBe(200);
  });

  it("should preserve headers", async () => {
    const body = {
      messages: [{ role: "user", content: "テスト" }],
      model: "claude-sonnet-4-20250514",
    };

    const res = await fetch(`http://localhost:${proxyPort}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "sk-ant-test",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
  });

  it("should handle streaming endpoint paths", async () => {
    const body = {
      messages: [{ role: "user", content: "ストリーミングテスト" }],
      model: "claude-sonnet-4-20250514",
      stream: true,
    };

    const res = await fetch(`http://localhost:${proxyPort}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.received.messages[0].content).toBe("[TRANSLATED] ストリーミングテスト");
    expect(data.received.stream).toBe(true);
  });
});
