import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import { createServer } from "./everything.js";
const corsOptions = {
    origin: "*",
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    preflightContinue: false,
    optionsSuccessStatus: 204,
    exposedHeaders: ["mcp-session-id", "last-event-id", "mcp-protocol-version"],
    allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-API-Key",
        "X-SolidityScan-API-Key",
        "Mcp-Session-Id",
        "X-MCP-Session-Id",
        "mcp-protocol-version",
        "Last-Event-ID",
    ],
};
export class SolidityScanMCPHTTPServer {
    port;
    host;
    app = express();
    httpServer;
    sessions = new Map();
    constructor(port, host = "0.0.0.0") {
        this.port = port;
        this.host = host;
        this.configureMiddleware();
        this.registerRoutes();
    }
    configureMiddleware() {
        this.app.disable("x-powered-by");
        this.app.use(cors(corsOptions));
    }
    registerRoutes() {
        this.app.get("/", (_req, res) => {
            this.sendHealth(res);
        });
        this.app.get("/health", (_req, res) => {
            this.sendHealth(res);
        });
        this.app.post("/mcp", (req, res) => {
            void this.handlePost(req, res);
        });
        this.app.get("/mcp", (req, res) => {
            void this.handleGet(req, res);
        });
        this.app.delete("/mcp", (req, res) => {
            void this.handleDelete(req, res);
        });
        this.app.use((_req, res) => {
            res.status(404).json({ error: "Not found" });
        });
    }
    async handlePost(req, res) {
        console.error("Received MCP POST request");
        try {
            const sessionId = getSessionIdFromRequest(req);
            const headerApiKey = extractApiKey(req);
            const augmentedReq = req;
            if (sessionId && this.sessions.has(sessionId)) {
                const session = this.sessions.get(sessionId);
                const effectiveKey = headerApiKey ?? session.resolverContext.apiKey;
                if (effectiveKey) {
                    this.attachAuth(augmentedReq, effectiveKey);
                    session.resolverContext.apiKey = effectiveKey;
                }
                await session.transport.handleRequest(augmentedReq, res);
                return;
            }
            if (sessionId) {
                this.sendJsonRpcError(res, 400, -32000, "Bad Request: No valid session ID provided", req?.body?.id);
                return;
            }
            const bundle = createServer();
            if (headerApiKey) {
                bundle.resolverContext.apiKey = headerApiKey;
                this.attachAuth(augmentedReq, headerApiKey);
            }
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                enableJsonResponse: true,
                eventStore: new InMemoryEventStore(),
                onsessioninitialized: (id) => {
                    console.error(`Session initialized with ID: ${id}`);
                    this.sessions.set(id, {
                        transport,
                        cleanup: bundle.cleanup,
                        resolverContext: bundle.resolverContext,
                    });
                },
                onsessionclosed: async (id) => {
                    await this.teardownSession(id);
                },
            });
            try {
                await bundle.server.connect(transport);
                await transport.handleRequest(augmentedReq, res);
                bundle.startNotificationIntervals(transport.sessionId);
            }
            catch (error) {
                await transport.close().catch(() => { });
                await bundle.cleanup().catch(() => { });
                throw error;
            }
        }
        catch (error) {
            this.handleRouteError("POST", error, res, req?.body?.id);
        }
    }
    async handleGet(req, res) {
        console.error("Received MCP GET request");
        try {
            const sessionId = getSessionIdFromRequest(req);
            if (!sessionId) {
                this.sendJsonRpcError(res, 400, -32000, "Bad Request: No valid session ID provided", req?.body?.id);
                return;
            }
            const session = this.sessions.get(sessionId);
            if (!session) {
                this.sendJsonRpcError(res, 400, -32000, "Bad Request: No valid session ID provided", req?.body?.id);
                return;
            }
            const headerApiKey = extractApiKey(req);
            const effectiveKey = headerApiKey ?? session.resolverContext.apiKey;
            if (effectiveKey) {
                this.attachAuth(req, effectiveKey);
                session.resolverContext.apiKey = effectiveKey;
            }
            const lastEventId = req.header("last-event-id");
            if (lastEventId) {
                console.error(`Client reconnecting with Last-Event-ID: ${lastEventId}`);
            }
            else {
                console.error(`Establishing new SSE stream for session ${sessionId}`);
            }
            await session.transport.handleRequest(req, res);
        }
        catch (error) {
            this.handleRouteError("GET", error, res, req?.body?.id);
        }
    }
    async handleDelete(req, res) {
        try {
            const sessionId = getSessionIdFromRequest(req);
            if (!sessionId) {
                this.sendJsonRpcError(res, 400, -32000, "Bad Request: No valid session ID provided", req?.body?.id);
                return;
            }
            console.error(`Received session termination request for session ${sessionId}`);
            const session = this.sessions.get(sessionId);
            if (!session) {
                this.sendJsonRpcError(res, 400, -32000, "Bad Request: No valid session ID provided", req?.body?.id);
                return;
            }
            const headerApiKey = extractApiKey(req);
            const effectiveKey = headerApiKey ?? session.resolverContext.apiKey;
            if (effectiveKey) {
                this.attachAuth(req, effectiveKey);
                session.resolverContext.apiKey = effectiveKey;
            }
            await session.transport.handleRequest(req, res);
        }
        catch (error) {
            this.handleRouteError("DELETE", error, res, req?.body?.id, "Error handling session termination");
        }
    }
    sendHealth(res) {
        res.status(200).json({ status: "ok", service: "solidityscan-mcp-server" });
    }
    attachAuth(req, apiKey) {
        req.apiKey = apiKey;
        req.auth = {
            token: apiKey,
            clientId: "http-client",
            scopes: [],
            extra: { apiKey },
        };
    }
    sendJsonRpcError(res, status, code, message, id = null) {
        res.status(status).json({
            jsonrpc: "2.0",
            error: {
                code,
                message,
            },
            id: id ?? null,
        });
    }
    handleRouteError(method, error, res, id, fallbackMessage = "Internal server error") {
        console.error(`Error handling MCP ${method} request:`, error);
        if (!res.headersSent) {
            this.sendJsonRpcError(res, 500, -32603, fallbackMessage, id);
        }
    }
    async teardownSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return;
        }
        console.error(`Transport closed for session ${sessionId}, removing from sessions map`);
        this.sessions.delete(sessionId);
        try {
            await session.transport.close();
        }
        catch (transportError) {
            console.error(`Error closing transport for session ${sessionId}`, transportError);
        }
        try {
            await session.cleanup();
        }
        catch (cleanupError) {
            console.error(`Error cleaning up session ${sessionId}`, cleanupError);
        }
    }
    async closeAllSessions() {
        const closures = Array.from(this.sessions.keys()).map((sessionId) => this.teardownSession(sessionId));
        await Promise.allSettled(closures);
    }
    async start() {
        if (this.httpServer) {
            return this.port;
        }
        await new Promise((resolve) => {
            this.httpServer = this.app.listen(this.port, this.host, () => {
                const address = this.httpServer?.address();
                if (address && typeof address !== "string") {
                    this.port = address.port;
                }
                resolve();
            });
        });
        return this.port;
    }
    async stop() {
        if (this.httpServer) {
            await new Promise((resolve, reject) => {
                this.httpServer.close((err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });
            this.httpServer = undefined;
        }
        await this.closeAllSessions();
    }
}
const isDirectRun = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirectRun) {
    console.error("Starting Streamable HTTP server...");
    const port = Number(process.env.PORT || process.env.SOLIDITYSCAN_MCP_PORT || 8080);
    const server = new SolidityScanMCPHTTPServer(port);
    server
        .start()
        .then((resolvedPort) => {
        console.error(`MCP Streamable HTTP Server listening on port ${resolvedPort}`);
    })
        .catch((error) => {
        console.error("Failed to start SolidityScan MCP HTTP server", error);
        process.exitCode = 1;
    });
    const handleShutdown = async () => {
        console.error("Shutting down server...");
        try {
            await server.stop();
            console.error("Server shutdown complete");
            process.exit(0);
        }
        catch (error) {
            console.error("Error during shutdown", error);
            process.exit(1);
        }
    };
    process.on("SIGINT", handleShutdown);
    process.on("SIGTERM", handleShutdown);
}
function extractApiKey(req) {
    const authHeader = req.header("authorization");
    if (typeof authHeader === "string") {
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (match) {
            return match[1];
        }
        return authHeader;
    }
    const apiKeyHeader = req.header("x-api-key");
    if (typeof apiKeyHeader === "string") {
        return apiKeyHeader;
    }
    const solidityScanHeader = req.header("x-solidityscan-api-key");
    if (typeof solidityScanHeader === "string") {
        return solidityScanHeader;
    }
    return undefined;
}
function getSessionIdFromRequest(req) {
    return req.header("mcp-session-id") ?? req.header("x-mcp-session-id") ?? undefined;
}
//# sourceMappingURL=server-http.js.map