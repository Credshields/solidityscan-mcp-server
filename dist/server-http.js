import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SolidityScanMCPServer } from "./server-core.js";
class WebSocketTransport {
    ws;
    sessionId;
    onclose;
    onerror;
    onmessage;
    setProtocolVersion;
    constructor(ws, sessionId) {
        this.ws = ws;
        this.sessionId = sessionId;
        this.ws.on("message", (data) => {
            try {
                const message = JSON.parse(data.toString());
                this.onmessage?.(message, {
                    requestInfo: { headers: {} },
                    authInfo: ws.authInfo,
                });
            }
            catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                this.onerror?.(err);
            }
        });
        this.ws.on("close", () => {
            this.onclose?.();
        });
        this.ws.on("error", (error) => {
            this.onerror?.(error);
        });
    }
    async start() {
        // No-op, WebSocket already connected
    }
    async send(message) {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
            return;
        }
        throw new Error("WebSocket is not open");
    }
    async close() {
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
            this.ws.close();
        }
        this.onclose?.();
    }
}
export class SolidityScanMCPHTTPServer {
    port;
    host;
    sessions = new Map();
    httpServer = createServer(this.handleRequest.bind(this));
    wss;
    constructor(port, host = "0.0.0.0") {
        this.port = port;
        this.host = host;
        this.wss = new WebSocketServer({
            server: this.httpServer,
            path: "/ws",
        });
        this.wss.on("connection", (ws, req) => {
            this.handleWebSocketConnection(ws, req);
        });
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
    startSseKeepAlive(res) {
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
            }
            catch (error) {
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
        const isSseRequest = req.method === "GET";
        const stopKeepAlive = isSseRequest ? this.startSseKeepAlive(res) : undefined;
        try {
            const headerValue = req.headers["mcp-session-id"] ?? req.headers["x-mcp-session-id"];
            const sessionId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
            if (sessionId && this.sessions.has(sessionId)) {
                const session = this.sessions.get(sessionId);
                if (apiKey) {
                    session.resolverContext.apiKey = apiKey;
                }
                if (session.transport instanceof StreamableHTTPServerTransport) {
                    await session.transport.handleRequest(req, res);
                }
                else {
                    this.sendJson(res, 400, {
                        jsonrpc: "2.0",
                        error: { code: -32000, message: "Session is using WebSocket transport" },
                        id: null,
                    });
                }
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
            const enableSSE = process.env.ENABLE_SSE !== "false";
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                enableJsonResponse: true,
                // Avoid hosts getting stuck on broken/unsupported SSE by allowing it to be disabled.
                // `enableSSE` is not yet in the published type definition, so we cast to `any` here.
                ...(enableSSE ? { enableSSE } : {}),
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
        finally {
            stopKeepAlive?.();
        }
    }
    async handleWebSocketConnection(ws, req) {
        const hostHeader = req.headers.host || `${this.host}:${this.port}`;
        const parsedUrl = new URL(req.url || "/", `ws://${hostHeader}`);
        const apiKey = this.extractApiKey(req, parsedUrl);
        ws.authInfo = apiKey
            ? {
                token: apiKey,
                clientId: "websocket-client",
                scopes: [],
                extra: { apiKey },
            }
            : undefined;
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
        const sessionId = randomUUID();
        const transport = new WebSocketTransport(ws, sessionId);
        transport.onclose = () => {
            this.sessions.delete(sessionId);
        };
        transport.onerror = (error) => {
            console.error(`WebSocket session ${sessionId} error:`, error);
        };
        try {
            await newServer.getServer().connect(transport);
            this.sessions.set(sessionId, {
                transport,
                server: newServer,
                resolverContext,
            });
        }
        catch (error) {
            console.error("Error handling WebSocket connection:", error);
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close(1011, "Internal server error");
            }
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
        await new Promise((resolve) => {
            this.wss.close(() => resolve());
        });
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
        console.error(`MCP WebSocket endpoint: ws://${host}:${actualPort}/ws`);
    })
        .catch((error) => {
        console.error("Failed to start SolidityScan MCP HTTP server", error);
        process.exitCode = 1;
    });
}
//# sourceMappingURL=server-http.js.map