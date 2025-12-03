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

export function createServer(): ServerBundle {
  const mcpServer = new SolidityScanMCPServer();
  const resolverContext: ResolverContext = {};

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

  const startNotificationIntervals = (_sessionId?: string) => {
    // Placeholder to keep parity with Inspector expectations.
  };

  return {
    server: mcpServer.getServer(),
    cleanup,
    startNotificationIntervals,
    resolverContext,
  };
}

