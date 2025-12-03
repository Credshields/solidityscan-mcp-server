export declare class SolidityScanMCPHTTPServer {
    private port;
    private host;
    private readonly app;
    private httpServer?;
    private readonly sessions;
    constructor(port: number, host?: string);
    private configureMiddleware;
    private registerRoutes;
    private handlePost;
    private handleGet;
    private handleDelete;
    private sendHealth;
    private attachAuth;
    private sendJsonRpcError;
    private handleRouteError;
    private teardownSession;
    private closeAllSessions;
    start(): Promise<number>;
    stop(): Promise<void>;
}
//# sourceMappingURL=server-http.d.ts.map