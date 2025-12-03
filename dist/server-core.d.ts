import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
type RequestContext = {
    authInfo?: AuthInfo;
    requestInfo?: unknown;
};
type ApiKeyResolver = (context?: RequestContext) => string | undefined;
export declare class SolidityScanMCPServer {
    private server;
    private platformChainCache?;
    private apiKeyResolver?;
    private jobManager;
    constructor();
    getServer(): Server<{
        method: string;
        params?: {
            [x: string]: unknown;
            _meta?: {
                [x: string]: unknown;
                progressToken?: string | number | undefined;
            } | undefined;
        } | undefined;
    }, {
        method: string;
        params?: {
            [x: string]: unknown;
            _meta?: {
                [x: string]: unknown;
            } | undefined;
        } | undefined;
    }, {
        [x: string]: unknown;
        _meta?: {
            [x: string]: unknown;
        } | undefined;
    }>;
    setApiKeyResolver(resolver: ApiKeyResolver): void;
    private resolveContextApiKey;
    private setupToolHandlers;
    private scanAndGetReportPDF;
    private executeScanAndGetReportPDF;
    private buildJobQueuedResponse;
    private formatJobMetadata;
    private getJobStatus;
    private getApiToken;
    private scanContract;
    private executeScanContract;
    private scanProject;
    private executeProjectScan;
    private loadPlatformChain;
    private resolvePlatformAndChain;
    private getSupportedPlatformsChains;
    private scanLocalDirectory;
    private executeLocalDirectoryScan;
    private scanFileContent;
    private executeFileContentScan;
}
export {};
//# sourceMappingURL=server-core.d.ts.map