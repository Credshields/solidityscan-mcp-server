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
- A SolidityScan API key (provided per-request via headers, query params, or tool arguments)

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

## API Key Configuration

API keys must be provided with each request. See the [API Key Handling](#api-key-handling) section below for all supported methods.

## Using with an MCP client

Connect to the server via HTTP endpoint. The server runs on port 8080 by default.

**MCP Endpoint:** `http://your-server:8080/mcp`

API keys must be provided per-request via headers, query parameters, or tool arguments.

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

Scripts:

```bash
pnpm dev     # Run with tsx (hot dev)
pnpm build   # Compile TypeScript
pnpm start   # Run compiled server
pnpm dev:http        # Run Streamable HTTP server with tsx
pnpm start:http      # Run compiled HTTP/SSE server
```

### Streamable HTTP + SSE transport

- `server-http.ts` hosts the MCP server over the Streamable HTTP transport, supporting both POST + SSE flows in a single endpoint.  
- Each request may include `Authorization: Bearer <SOLIDITYSCAN API KEY>` or `X-API-Key`; the server caches the first key seen for the session and reuses it for subsequent requests/subscriptions.

## CI/CD Pipeline

The project includes a GitHub Actions workflow that automatically builds and pushes Docker images to AWS ECR.

### Setup

1. **Create ECR Repository:**
   ```bash
   aws ecr create-repository --repository-name solidityscan-mcp-server --region us-east-1
   ```

2. **Configure GitHub Secrets:**
   Go to your repository Settings → Secrets and variables → Actions, and add:
   - `AWS_ACCESS_KEY_ID` - Your AWS access key
   - `AWS_SECRET_ACCESS_KEY` - Your AWS secret key

3. **Update Workflow Configuration (if needed):**
   Edit `.github/workflows/build-and-push-ecr.yml` to change:
   - `AWS_REGION` (default: `us-east-1`)
   - `ECR_REPOSITORY` (default: `solidityscan-mcp-server`)

### Workflow Behavior

The workflow runs on:
- Push to `main` or `master` branch
- Push of version tags (e.g., `v1.0.0`)
- Manual trigger via `workflow_dispatch`

### Image Tagging

- **Commits to main/master:** Tagged with `latest` and short SHA (e.g., `abc1234`)
- **Version tags:** Tagged with the version tag (e.g., `v1.0.0`) and SHA
- **All builds:** Tagged with the commit SHA

### Using the Image from ECR

After the workflow runs, update `docker-stack.yml` to use the ECR image:

1. **Get your ECR registry URL:**
   ```bash
   aws ecr describe-repositories --repository-names solidityscan-mcp-server --region us-east-1 --query 'repositories[0].repositoryUri' --output text
   ```

2. **Update `docker-stack.yml`:**
   Change the `image` field from:
   ```yaml
   image: solidityscan-mcp-server:latest
   ```
   To:
   ```yaml
   image: <account-id>.dkr.ecr.us-east-1.amazonaws.com/solidityscan-mcp-server:latest
   ```

3. **Login to ECR on your Swarm nodes:**
   ```bash
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com
   ```

4. **Deploy the stack:**
   ```bash
   docker stack deploy -c docker-stack.yml solidityscan-mcp
   ```

## Deploying to EC2 (or any Linux server)

### Option 1: Using Docker Swarm (Recommended for Production)

Docker Swarm provides production-ready orchestration with high availability, rolling updates, and load balancing.

**Quick Start:**
```bash
# Initialize Swarm (if not already)
docker swarm init

# Build image
docker build -t solidityscan-mcp-server:latest .

# Deploy stack (users provide API keys per-request)
docker stack deploy -c docker-stack.yml solidityscan-mcp

# Check status
docker stack services solidityscan-mcp
```

### Option 2: Using PM2

1. **Install dependencies on EC2:**
   ```bash
   # Install Node.js 20+ and pnpm
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   npm install -g pnpm
   
   # Clone and build the project
   git clone <your-repo-url>
   cd solidityscan-mcp-server
   pnpm install
   pnpm build
   ```

2. **Install PM2:**
   ```bash
   npm install -g pm2
   ```

3. **Create logs directory:**
   ```bash
   mkdir -p logs
   ```

4. **Set environment variables (optional):**
   ```bash
   export PORT=8080
   export HOST=0.0.0.0
   ```

5. **Start with PM2:**
   ```bash
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup  # Follow instructions to enable auto-start on reboot
   ```

6. **Manage the service:**
   ```bash
   pm2 status
   pm2 logs solidityscan-mcp-server
   pm2 restart solidityscan-mcp-server
   pm2 stop solidityscan-mcp-server
   ```

7. **Configure firewall (if needed):**
   ```bash
   sudo ufw allow 8080/tcp
   ```

### Option 3: Using Docker (Single Container)

1. **Build the Docker image:**
   ```bash
   docker build -t solidityscan-mcp-server .
   ```

2. **Run the container:**
   ```bash
   docker run -d \
     --name solidityscan-mcp \
     -p 8080:8080 \
     -e PORT=8080 \
     -e HOST=0.0.0.0 \
     --restart unless-stopped \
     solidityscan-mcp-server
   ```

3. **View logs:**
   ```bash
   docker logs -f solidityscan-mcp
   ```

### Option 4: Using systemd

1. **Create a systemd service file** `/etc/systemd/system/solidityscan-mcp.service`:
   ```ini
   [Unit]
   Description=SolidityScan MCP Server
   After=network.target

   [Service]
   Type=simple
   User=ubuntu
   WorkingDirectory=/path/to/solidityscan-mcp-server
   Environment="PORT=8080"
   Environment="HOST=0.0.0.0"
   ExecStart=/usr/bin/node dist/server-http.js
   Restart=always
   RestartSec=10

   [Install]
   WantedBy=multi-user.target
   ```

2. **Enable and start the service:**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable solidityscan-mcp
   sudo systemctl start solidityscan-mcp
   sudo systemctl status solidityscan-mcp
   ```

### Using Nginx as a Reverse Proxy (Optional)

Create `/etc/nginx/sites-available/solidityscan-mcp`:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable and restart:
```bash
sudo ln -s /etc/nginx/sites-available/solidityscan-mcp /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## API Key Handling

**API keys must be provided with each request.** The server accepts API keys in multiple ways with the following priority:

1. **Tool Arguments** - `apiToken` parameter in each tool call (highest priority)
2. **HTTP Headers** - `Authorization: Bearer <token>`, `X-API-Key`, or `X-SolidityScan-API-Key`
3. **Query Parameters** - `?token=...`, `?apiKey=...`, `?api_key=...`, or `?solidityscan_api_key=...`

The server will reject requests without an API key.

## Using Tokens with MCP Host URL

The server supports multiple ways to provide your SolidityScan API token when connecting via HTTP:

### Method 1: Authorization Header (Recommended)
```javascript
const transport = new StreamableHTTPClientTransport(baseUrl, {
  requestInit: {
    headers: {
      Authorization: `Bearer YOUR_API_TOKEN`,
    },
  },
});
```

### Method 2: X-API-Key Header
```javascript
const transport = new StreamableHTTPClientTransport(baseUrl, {
  requestInit: {
    headers: {
      "X-API-Key": "YOUR_API_TOKEN",
    },
  },
});
```

### Method 3: X-SolidityScan-API-Key Header
```javascript
const transport = new StreamableHTTPClientTransport(baseUrl, {
  requestInit: {
    headers: {
      "X-SolidityScan-API-Key": "YOUR_API_TOKEN",
    },
  },
});
```

### Method 4: Query Parameter (for URL-based integration)
You can include the token directly in the MCP host URL:
```
http://your-server.com:8080/mcp?token=YOUR_API_TOKEN
```

Or with other parameter names:
```
http://your-server.com:8080/mcp?apiKey=YOUR_API_TOKEN
http://your-server.com:8080/mcp?api_key=YOUR_API_TOKEN
http://your-server.com:8080/mcp?solidityscan_api_key=YOUR_API_TOKEN
```

**Note:** Query parameters are less secure as they may appear in logs. Prefer headers when possible.

### Example: Connecting from Cursor or other MCP clients

When configuring an MCP server with a host URL, you can use:

**With header (recommended):**
```json
{
  "mcpServers": {
    "solidityscan": {
      "url": "http://your-ec2-instance:8080/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_TOKEN"
      }
    }
  }
}
```

**With query parameter:**
```json
{
  "mcpServers": {
    "solidityscan": {
      "url": "http://your-ec2-instance:8080/mcp?token=YOUR_API_TOKEN"
    }
  }
}
```

### Token Priority

The server checks for tokens in this order:
1. Tool arguments (`apiToken` parameter in individual tool calls) - highest priority
2. Request headers (`Authorization: Bearer`, `X-API-Key`, `X-SolidityScan-API-Key`)
3. Query parameters (`token`, `apiKey`, `api_key`, `solidityscan_api_key`)

The first token found is used for the session. If a token is provided in the initial request, it's cached for that session and reused for subsequent requests.

## How platform/chain resolution works

- Platform can be provided by name (e.g., `etherscan`, `polygonscan`, `blockscout`, `arbiscan`, etc.) or by platform ID from the index.
- Chain can be provided by chain name for that platform (e.g., `sepolia`, `mainnet`, `amoy-testnet`) or by the chain ID value listed under that platform.
- If an unsupported value is provided, the server returns an error with the list of available chains for the selected platform.

## Troubleshooting

- Missing API key: provide API key via headers, query parameters, or `apiToken` in tool arguments.
- Unsupported platform/chain: call `get_supported_platforms_chains` and use a listed value.
- File/directory not found: ensure absolute paths exist and are accessible to the server process.

## License

MIT

## Acknowledgements

- Built on `@modelcontextprotocol/sdk`
- Security scanning by `solidityscan`


