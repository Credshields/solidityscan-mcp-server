import { SolidityScanMCPServer } from "./server-core.js";
export function createServer() {
    const mcpServer = new SolidityScanMCPServer();
    const resolverContext = {};
    mcpServer.setApiKeyResolver((context) => {
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
    const cleanup = async () => {
        // Placeholder for future cleanup hooks.
    };
    const startNotificationIntervals = (_sessionId) => {
        // Placeholder to keep parity with Inspector expectations.
    };
    return {
        server: mcpServer.getServer(),
        cleanup,
        startNotificationIntervals,
        resolverContext,
    };
}
//# sourceMappingURL=everything.js.map