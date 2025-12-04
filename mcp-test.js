// Simple local MCP client to exercise the SolidityScan MCP HTTP/SSE server on localhost:8080/mcp
// Flow: initialize -> tools/list -> scan_contract (single long-running call over HTTP/SSE)

const ENDPOINT = process.env.MCP_URL || "http://127.0.0.1:8080/mcp";

async function post(body, headers = {}) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

(async () => {
  console.log("Endpoint:", ENDPOINT);

  // 1) initialize
  const init = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "local-test-client", version: "1.0.0" },
    },
  });
  console.log("=== INIT ===");
  console.log("Status:", init.status);
  console.log("Body:", init.text);

  const sessionId = init.headers.get("mcp-session-id");
  if (!sessionId) {
    console.error("No mcp-session-id in init response, aborting.");
    process.exit(1);
  }
  console.log("Session ID:", sessionId);

  const baseHeaders = { "Mcp-Session-Id": sessionId };

  // 2) list tools
  const list = await post(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    },
    baseHeaders
  );
  console.log("\n=== TOOLS/LIST ===");
  console.log("Status:", list.status);
  console.log("Body:", list.text);

  // 3) start a contract scan (async, returns jobId)
  const apiToken = process.env.SOLIDITYSCAN_API_KEY || "DUMMY_API_TOKEN";
  const scan = await post(
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "scan_contract",
        arguments: {
          contractAddress: "0x759238fb254950D7743F5daB44714C74634E3EDD",
          platform: "etherscan",
          chain: "mainnet",
          apiToken,
        },
      },
    },
    baseHeaders
  );
  console.log("\n=== TOOLS/CALL scan_contract ===");
  console.log("Status:", scan.status);
  console.log("Body:", scan.text);

  console.log("\n=== FINAL RESULT (single call) ===");
  try {
    const body = JSON.parse(scan.text);
    console.log(JSON.stringify(body, null, 2));
  } catch {
    console.log("Non-JSON body:", scan.text);
  }
})().catch((e) => {
  console.error("Test client error:", e);
  process.exit(1);
});


