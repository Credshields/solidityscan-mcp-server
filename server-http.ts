import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { SolidityScanMCPServer } from "./server-core.js";

type AugmentedRequest = IncomingMessage & {
  auth?: AuthInfo;
  apiKey?: string;
};

type SessionRecord = {
  transport: StreamableHTTPServerTransport;
  server: SolidityScanMCPServer;
  resolverContext: {
    apiKey?: string;
  };
};

export class SolidityScanMCPHTTPServer {
  private sessions = new Map<string, SessionRecord>();
  private httpServer = createServer(this.handleRequest.bind(this));

  constructor(private port: number, private host = "0.0.0.0") {}

  private extractApiKey(req: IncomingMessage, url?: URL): string | undefined {
    // Try Authorization header (Bearer token)
    const authHeader = req.headers.authorization;
    if (typeof authHeader === "string") {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match) {
        return match[1];
      }
      return authHeader;
    }
    
    // Try X-API-Key header
    const apiKeyHeader = req.headers["x-api-key"];
    if (typeof apiKeyHeader === "string") {
      return apiKeyHeader;
    }
    
    // Try X-SolidityScan-API-Key header
    const solidityScanHeader = req.headers["x-solidityscan-api-key"];
    if (typeof solidityScanHeader === "string") {
      return solidityScanHeader;
    }
    
    // Try query parameters (for MCP host URL integration)
    if (url) {
      const queryToken = url.searchParams.get("token") || 
                        url.searchParams.get("apiKey") || 
                        url.searchParams.get("api_key") ||
                        url.searchParams.get("solidityscan_api_key");
      if (queryToken) {
        return queryToken;
      }
    }
    
    return undefined;
  }

  private setCorsHeaders(res: ServerResponse, req: IncomingMessage) {
    const origin = req.headers.origin;
    // Allow specific origins or use environment variable for allowed origins
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [];
    if (origin && (allowedOrigins.includes(origin) || allowedOrigins.length === 0)) {
      res.setHeader("Access-Control-Allow-Origin", origin || "*");
    } else if (allowedOrigins.length === 0) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-API-Key, X-SolidityScan-API-Key, Mcp-Session-Id, X-MCP-Session-Id, mcp-protocol-version"
    );
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  private sendJson(res: ServerResponse, status: number, body: Record<string, unknown>) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  private startSseKeepAlive(res: ServerResponse) {
    const intervalMs = Number(process.env.SSE_KEEPALIVE_INTERVAL_MS ?? 15000);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      return;
    }

    const writeHeartbeat = () => {
      if (res.writableEnded) {
        cleanup();
        return;
      }
      if (!res.headersSent) {
        // StreamableHTTPTransport hasn't flushed headers yet; try again later.
        return;
      }
      try {
        res.write(`: keepalive ${new Date().toISOString()}\n\n`);
      } catch (error) {
        console.error("Failed to send SSE keepalive event:", error);
        cleanup();
      }
    };

    const interval = setInterval(writeHeartbeat, intervalMs);
    interval.unref?.();

    const cleanup = () => {
      clearInterval(interval);
      res.off("close", cleanup);
      res.off("finish", cleanup);
      res.off("error", cleanup);
    };

    res.on("close", cleanup);
    res.on("finish", cleanup);
    res.on("error", cleanup);

    return cleanup;
  }

  private async handleRequest(rawReq: IncomingMessage, res: ServerResponse) {
    const req = rawReq as AugmentedRequest;
    this.setCorsHeaders(res, req);
    
    if (req.method === "OPTIONS") {
      res.writeHead(200).end();
      return;
    }

    const hostHeader = req.headers.host || `${this.host}:${this.port}`;
    const parsedUrl = new URL(req.url || "/", `http://${hostHeader}`);
    const pathname = parsedUrl.pathname || "/";

    // Extract API key (from headers or query params)
    const apiKey = this.extractApiKey(req, parsedUrl);
    if (apiKey) {
      req.apiKey = apiKey;
      req.auth = {
        token: apiKey,
        clientId: "http-client",
        scopes: [],
        extra: { apiKey },
      };
    }

    if (pathname === "/" || pathname === "/health") {
      this.sendJson(res, 200, { 
        status: "ok", 
        service: "solidityscan-mcp-server",
        version: "1.0.0",
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (pathname === "/mcp" || pathname === "/sse") {
      await this.handleMcpRequest(req, res, apiKey);
      return;
    }

    this.sendJson(res, 404, { error: "Not found", path: pathname });
  }

  private async handleMcpRequest(req: AugmentedRequest, res: ServerResponse, apiKey?: string) {
    const isSseRequest = req.method === "GET";
    const stopKeepAlive = isSseRequest ? this.startSseKeepAlive(res) : undefined;

    try {
      const headerValue = req.headers["mcp-session-id"] ?? req.headers["x-mcp-session-id"];
      const sessionId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
      if (sessionId && this.sessions.has(sessionId)) {
        const session = this.sessions.get(sessionId)!;
        if (apiKey) {
          session.resolverContext.apiKey = apiKey;
        }
        await session.transport.handleRequest(req, res);
        return;
      }

      if (sessionId) {
        this.sendJson(res, 400, {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Unknown MCP session" },
          id: null,
        });
        return;
      }

      const newServer = new SolidityScanMCPServer();
      const resolverContext: SessionRecord["resolverContext"] = { apiKey };
      newServer.setApiKeyResolver((context) => {
        if (resolverContext.apiKey) {
          return resolverContext.apiKey;
        }
        const extraKey = context?.authInfo?.extra?.apiKey;
        if (typeof extraKey === "string") {
          return extraKey;
        }
        const token = context?.authInfo?.token;
        if (typeof token === "string") {
          return token;
        }
        return undefined;
      });

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
          this.sessions.set(id, {
            transport,
            server: newServer,
            resolverContext,
          });
        },
        onsessionclosed: (id) => {
          this.sessions.delete(id);
        },
      });

      await newServer.getServer().connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("Error handling MCP HTTP request", error);
      // Don't leak internal error details in production
      this.sendJson(res, 500, { 
        error: "Internal server error",
        ...(process.env.NODE_ENV === "development" && { details: errorMessage })
      });
    } finally {
      stopKeepAlive?.();
    }
  }

  async start() {
    await new Promise<void>((resolve) => {
      this.httpServer.listen(this.port, this.host, () => {
        const address = this.httpServer.address() as AddressInfo | string | null;
        if (address && typeof address !== "string") {
          this.port = address.port;
        }
        resolve();
      });
    });
    return this.port;
  }

  async stop() {
    // Close all active sessions
    for (const [sessionId, session] of this.sessions.entries()) {
      try {
        await session.transport.close();
      } catch (error) {
        console.error(`Error closing session ${sessionId}:`, error);
      }
    }
    this.sessions.clear();

    // Close HTTP server
    await new Promise<void>((resolve, reject) => {
      this.httpServer.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
}

const isDirectRun = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectRun) {
  const port = Number(process.env.PORT || process.env.SOLIDITYSCAN_MCP_PORT || 8080);
  const host = process.env.HOST || process.env.SOLIDITYSCAN_MCP_HOST || "0.0.0.0";
  const server = new SolidityScanMCPHTTPServer(port, host);
  
  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    console.error(`Received ${signal}, shutting down gracefully...`);
    try {
      await server.stop();
      console.error("Server stopped successfully");
      process.exit(0);
    } catch (error) {
      console.error("Error during shutdown:", error);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  server
    .start()
    .then((actualPort) => {
      console.error(`SolidityScan MCP HTTP server listening on ${host}:${actualPort}`);
      console.error(`Health check: http://${host}:${actualPort}/health`);
      console.error(`MCP endpoint: http://${host}:${actualPort}/mcp`);
    })
    .catch((error) => {
      console.error("Failed to start SolidityScan MCP HTTP server", error);
      process.exitCode = 1;
    });
}

