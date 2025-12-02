## SolidityScan MCP Server

An MCP (Model Context Protocol) server that exposes SolidityScan smart contract security analysis as MCP tools. Use it from MCP-capable clients to scan deployed contracts, Git projects, local directories, or inline Solidity source, and to generate quick PDF reports.

### What you get

- **scan_contract**: Deep scan of a deployed contract by address
- **scan_and_get_report_pdf**: Quick scan + PDF report link
- **scan_project**: Scan a remote Git repository
- **scan_local_directory**: Scan local Solidity code on disk
- **scan_file_content**: Scan raw Solidity source (in-memory)
- **get_supported_platforms_chains**: Discover supported explorers and chains

Powered by the SolidityScan SDK.

## Requirements

- Node.js 18+
- A SolidityScan API key set as `SOLIDITYSCAN_API_KEY` (or pass `apiToken` per request)

## Install

```bash
pnpm install
pnpm build
```

Run locally (dev):

```bash
pnpm dev
```

Run the built server:

```bash
pnpm start
```

If published as a package with a binary (`solidityscan-mcp-server`), you can also run:

```bash
npx solidityscan-mcp-server
```

## Configure API key

Set your API key once for all requests:

```bash
export SOLIDITYSCAN_API_KEY="<your-api-key>"
```

Or pass `apiToken` with individual tool calls.

## Using with an MCP client

Any MCP-capable client can connect to this server over stdio. Examples:

### Claude Desktop (example)

Add an entry to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "solidityscan": {
      "command": "/usr/bin/env",
      "args": ["node", "/absolute/path/to/dist/index.js"],
      "env": {
        "SOLIDITYSCAN_API_KEY": "<your-api-key>"
      }
    }
  }
}
```

### Cursor or other MCP clients

Register a new MCP server with the command set to `node` and the argument pointing to `dist/index.js` (or the CLI `solidityscan-mcp-server` if installed globally). Ensure `SOLIDITYSCAN_API_KEY` is available in the server environment.

## Available tools

| Tool | Description | Required inputs |
|---|---|---|
| `get_supported_platforms_chains` | Lists supported explorers/platforms and their chains (names mapped to IDs) | – |
| `scan_contract` | Scan a deployed contract by address | `contractAddress`, `platform`, `chain` |
| `scan_and_get_report_pdf` | Quick scan and return a PDF report link | `contractAddress`, `platform`, `chain` |
| `scan_project` | Scan a Git repository project | `provider`, `projectUrl`, `projectName` |
| `scan_local_directory` | Scan a local directory of Solidity files | `directoryPath` |
| `scan_file_content` | Scan raw Solidity source content | `fileContent` |

Notes:

- Use `get_supported_platforms_chains` to discover valid `platform` names and their `chain` names/IDs.
- Although some client UIs may not mark `platform` as required, this server requires it for chain resolution.

## Examples

First, discover platforms and chains:

```text
get_supported_platforms_chains
```

Example response (truncated):

```json
{
  "etherscan": {
    "id": "1",
    "chains": { "mainnet": "1", "sepolia": "4", "holesky": "6" }
  },
  "polygonscan": {
    "id": "3",
    "chains": { "mainnet": "1", "testnet": "2", "amoy-testnet": "10" }
  }
}
```

### Scan a deployed contract

```json
{
  "tool": "scan_contract",
  "arguments": {
    "contractAddress": "0x0000000000000000000000000000000000000000",
    "platform": "etherscan",
    "chain": "sepolia"
  }
}
```

### Quick scan and PDF report link

```json
{
  "tool": "scan_and_get_report_pdf",
  "arguments": {
    "contractAddress": "0x0000000000000000000000000000000000000000",
    "platform": "etherscan",
    "chain": "sepolia"
  }
}
```

The server responds with a `https://solidityscan.com/qs-report/<project_id>/<report_id>/<scan_id>` link.

### Scan a Git project

```json
{
  "tool": "scan_project",
  "arguments": {
    "provider": "github",
    "projectUrl": "https://github.com/org/repo",
    "projectName": "MyDapp",
    "projectBranch": "main",
    "recurScans": false,
    "skipFilePaths": []
  }
}
```

### Scan a local directory

```json
{
  "tool": "scan_local_directory",
  "arguments": {
    "directoryPath": "/absolute/path/to/contracts",
    "projectName": "LocalScan"
  }
}
```

### Scan raw Solidity source content

```json
{
  "tool": "scan_file_content",
  "arguments": {
    "fileName": "Sample.sol",
    "projectName": "InlineScan",
    "fileContent": "pragma solidity ^0.8.20; contract A { function f() external {} }"
  }
}
```

## Development

- TypeScript entrypoint: `index.ts`
- Built output: `dist/index.js`

Scripts:

```bash
pnpm dev     # Run with tsx (hot dev)
pnpm build   # Compile TypeScript
pnpm start   # Run compiled server
pnpm dev:http        # Run Streamable HTTP server with tsx
pnpm start:http      # Run compiled HTTP/SSE server
pnpm test:http-client # Launch HTTP server + client smoke test
```

### Streamable HTTP + SSE transport

- `server-http.ts` hosts the MCP server over the Streamable HTTP transport, supporting both POST + SSE flows in a single endpoint.  
- Each request may include `Authorization: Bearer <SOLIDITYSCAN API KEY>` or `X-API-Key`; the server caches the first key seen for the session and reuses it for subsequent requests/subscriptions.  
- `pnpm test:http-client` boots the HTTP server on an ephemeral port, spins up a `StreamableHTTPClientTransport` with the provided header, and runs `listTools` as a smoke test. Set `SOLIDITYSCAN_TEST_API_KEY` (or reuse `SOLIDITYSCAN_API_KEY`) to make the test send a real key.

## How platform/chain resolution works

- Platform can be provided by name (e.g., `etherscan`, `polygonscan`, `blockscout`, `arbiscan`, etc.) or by platform ID from the index.
- Chain can be provided by chain name for that platform (e.g., `sepolia`, `mainnet`, `amoy-testnet`) or by the chain ID value listed under that platform.
- If an unsupported value is provided, the server returns an error with the list of available chains for the selected platform.

## Troubleshooting

- Missing API key: set `SOLIDITYSCAN_API_KEY` or pass `apiToken`.
- Unsupported platform/chain: call `get_supported_platforms_chains` and use a listed value.
- File/directory not found: ensure absolute paths exist and are accessible to the server process.

## License

MIT

## Acknowledgements

- Built on `@modelcontextprotocol/sdk`
- Security scanning by `solidityscan`


