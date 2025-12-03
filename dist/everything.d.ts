import { SolidityScanMCPServer } from "./server-core.js";
type MCPServerInstance = ReturnType<SolidityScanMCPServer["getServer"]>;
export type ResolverContext = {
    apiKey?: string;
};
export type ServerBundle = {
    server: MCPServerInstance;
    cleanup: () => Promise<void>;
    startNotificationIntervals: (sessionId?: string) => void;
    resolverContext: ResolverContext;
};
export declare function createServer(): ServerBundle;
export {};
//# sourceMappingURL=everything.d.ts.map