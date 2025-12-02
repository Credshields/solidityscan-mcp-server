import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SolidityScanMCPServer } from "./server-core.js";
const server = new SolidityScanMCPServer();
async function run() {
    const transport = new StdioServerTransport();
    await server.getServer().connect(transport);
    console.error("SolidityScan MCP Server running on stdio");
}
run().catch((error) => {
    console.error("Failed to start SolidityScan MCP stdio server", error);
    process.exitCode = 1;
});
//# sourceMappingURL=index.js.map