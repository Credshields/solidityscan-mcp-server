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

  private extractApiKey(req: IncomingMessage) {
    const authHeader = req.headers.authorization;
    if (typeof authHeader === "string") {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match) {
        return match[1];
      }
      return authHeader;
    }
    const apiKeyHeader = req.headers["x-api-key"];
    if (typeof apiKeyHeader === "string") {
      return apiKeyHeader;
    }
    const solidityScanHeader = req.headers["x-solidityscan-api-key"];
    if (typeof solidityScanHeader === "string") {
      return solidityScanHeader;
    }
    return undefined;
  }

  private setCorsHeaders(res: ServerResponse) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-API-Key, X-SolidityScan-API-Key, Mcp-Session-Id, X-MCP-Session-Id, mcp-protocol-version"
    );
  }

  private sendJson(res: ServerResponse, status: number, body: Record<string, unknown>) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  private async handleRequest(rawReq: IncomingMessage, res: ServerResponse) {
    const req = rawReq as AugmentedRequest;
    this.setCorsHeaders(res);
    if (req.method === "OPTIONS") {
      res.writeHead(200).end();
      return;
    }

    const apiKey = this.extractApiKey(req);
    if (apiKey) {
      req.apiKey = apiKey;
      req.auth = {
        token: apiKey,
        clientId: "http-client",
        scopes: [],
        extra: { apiKey },
      };
    }

    const hostHeader = req.headers.host || `${this.host}:${this.port}`;
    const parsedUrl = new URL(req.url || "/", `http://${hostHeader}`);
    const pathname = parsedUrl.pathname || "/";

    if (pathname === "/" || pathname === "/health") {
      this.sendJson(res, 200, { status: "ok", service: "solidityscan-mcp-server" });
      return;
    }

    if (pathname === "/mcp" || pathname === "/sse") {
      await this.handleMcpRequest(req, res, apiKey);
      return;
    }

    this.sendJson(res, 404, { error: "Not found" });
  }

  private async handleMcpRequest(req: AugmentedRequest, res: ServerResponse, apiKey?: string) {
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
      console.error("Error handling MCP HTTP request", error);
      this.sendJson(res, 500, { error: "Internal server error" });
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
  const server = new SolidityScanMCPHTTPServer(port);
  server
    .start()
    .then(() => {
      console.error(`SolidityScan MCP HTTP server listening on port ${port}`);
    })
    .catch((error) => {
      console.error("Failed to start SolidityScan MCP HTTP server", error);
      process.exitCode = 1;
    });
}

