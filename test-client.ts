import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SolidityScanMCPHTTPServer } from "./server-http.js";

async function main() {
  const apiKey =
    process.env.SOLIDITYSCAN_TEST_API_KEY ||
    process.env.SOLIDITYSCAN_API_KEY ||
    "test-api-key";

  // const server = new SolidityScanMCPHTTPServer(0);
  // const port = await server.start();
  // const baseUrl = new URL(`http://127.0.0.1:${port}/mcp`);
  const baseUrl = new URL('https://mcp.solidityscan.com/mcp')

  const transport = new StreamableHTTPClientTransport(baseUrl, {
    requestInit: {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  });

  const client = new Client({
    name: "solidityscan-http-test-client",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);
    const result = await client.listTools();
    console.log(
      JSON.stringify({
        // port,
        toolCount: result.tools.length,
        tools: result.tools.map((tool) => tool.name),
      })
    );
  } finally {
    await client.close().catch(() => {});
    // await server.stop().catch(() => {});
  }
}

main().catch((error) => {
  console.error("HTTP client smoke test failed", error);
  process.exitCode = 1;
});

