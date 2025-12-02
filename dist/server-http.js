import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SolidityScanMCPServer } from "./server-core.js";
export class SolidityScanMCPHTTPServer {
    port;
    host;
    sessions = new Map();
    httpServer = createServer(this.handleRequest.bind(this));
    constructor(port, host = "0.0.0.0") {
        this.port = port;
        this.host = host;
    }
    extractApiKey(req, url) {
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
    setCorsHeaders(res, req) {
        const origin = req.headers.origin;
        // Allow specific origins or use environment variable for allowed origins
        const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [];
        if (origin && (allowedOrigins.includes(origin) || allowedOrigins.length === 0)) {
            res.setHeader("Access-Control-Allow-Origin", origin || "*");
        }
        else if (allowedOrigins.length === 0) {
            res.setHeader("Access-Control-Allow-Origin", "*");
        }
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key, X-SolidityScan-API-Key, Mcp-Session-Id, X-MCP-Session-Id, mcp-protocol-version");
        res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    sendJson(res, status, body) {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
    }
    async handleRequest(rawReq, res) {
        const req = rawReq;
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
    async handleMcpRequest(req, res, apiKey) {
        try {
            const headerValue = req.headers["mcp-session-id"] ?? req.headers["x-mcp-session-id"];
            const sessionId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
            if (sessionId && this.sessions.has(sessionId)) {
                const session = this.sessions.get(sessionId);
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
            const resolverContext = { apiKey };
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
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            console.error("Error handling MCP HTTP request", error);
            // Don't leak internal error details in production
            this.sendJson(res, 500, {
                error: "Internal server error",
                ...(process.env.NODE_ENV === "development" && { details: errorMessage })
            });
        }
    }
    async start() {
        await new Promise((resolve) => {
            this.httpServer.listen(this.port, this.host, () => {
                const address = this.httpServer.address();
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
            }
            catch (error) {
                console.error(`Error closing session ${sessionId}:`, error);
            }
        }
        this.sessions.clear();
        // Close HTTP server
        await new Promise((resolve, reject) => {
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
    const shutdown = async (signal) => {
        console.error(`Received ${signal}, shutting down gracefully...`);
        try {
            await server.stop();
            console.error("Server stopped successfully");
            process.exit(0);
        }
        catch (error) {
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
//# sourceMappingURL=server-http.js.map