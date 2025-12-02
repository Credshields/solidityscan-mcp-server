export declare class SolidityScanMCPHTTPServer {
    private port;
    private host;
    private sessions;
    private httpServer;
    constructor(port: number, host?: string);
    private extractApiKey;
    private setCorsHeaders;
    private sendJson;
    private handleRequest;
    private handleMcpRequest;
    start(): Promise<number>;
    stop(): Promise<void>;
}
//# sourceMappingURL=server-http.d.ts.map