export declare class SolidityScanMCPHTTPServer {
    private port;
    private host;
    private sessions;
    private httpServer;
    private wss;
    constructor(port: number, host?: string);
    private extractApiKey;
    private setCorsHeaders;
    private sendJson;
    private startSseKeepAlive;
    private handleRequest;
    private handleMcpRequest;
    private handleWebSocketConnection;
    start(): Promise<number>;
    stop(): Promise<void>;
}
//# sourceMappingURL=server-http.d.ts.map