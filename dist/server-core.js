import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as solidityscan from "solidityscan";
import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
const originalConsoleError = console.error.bind(console);
console.log = (...args) => {
    originalConsoleError(...args);
};
console.info = (...args) => {
    originalConsoleError(...args);
};
console.warn = (...args) => {
    originalConsoleError(...args);
};
console.debug = (...args) => {
    originalConsoleError(...args);
};
process.on("uncaughtException", (err) => {
    originalConsoleError("Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
    originalConsoleError("Unhandled rejection:", reason);
});
const ScanContractSchema = z.object({
    contractAddress: z.string().describe("The deployed contract address to scan"),
    chain: z.string().describe("Chain name from platform-chain.json"),
    platform: z.string().describe("Platform name from platform-chain.json"),
    apiToken: z
        .string()
        .optional()
        .describe("SolidityScan API token (optional if set in environment or headers)"),
});
const ScanProjectSchema = z.object({
    provider: z.string().describe("Git provider (e.g., github, gitlab)"),
    projectUrl: z.string().describe("Full URL to the git repository"),
    projectName: z.string().describe("Name for the project scan"),
    projectBranch: z.string().default("main").describe("Branch to scan"),
    recurScans: z.boolean().default(false).describe("Enable recurring scans"),
    skipFilePaths: z.array(z.string()).default([]).describe("File paths to skip during scanning"),
    apiToken: z.string().optional().describe("SolidityScan API token"),
});
const ScanLocalDirectorySchema = z.object({
    directoryPath: z.string().describe("Path to local directory containing Solidity files"),
    projectName: z.string().default("LocalScan").describe("Name for the local project scan"),
    apiToken: z.string().optional().describe("SolidityScan API token"),
});
const ScanFileContentSchema = z.object({
    fileContent: z.string().describe("Raw Solidity contract source code to scan"),
    fileName: z.string().default("Contract.sol").describe("Name for the contract file"),
    projectName: z.string().default("InlineScan").describe("Name for the scan project"),
    apiToken: z.string().optional().describe("SolidityScan API token"),
});
const ScanAndGetReportPDFSchema = z.object({
    contractAddress: z.string().describe("The deployed contract address to scan"),
    chain: z.string().describe("Chain name from platform-chain.json"),
    platform: z.string().describe("Platform name from platform-chain.json"),
    reportOptions: z.any().optional().describe("Optional report generation options expected by the SDK"),
    apiToken: z
        .string()
        .optional()
        .describe("SolidityScan API token (optional if set in environment or headers)"),
});
export class SolidityScanMCPServer {
    server;
    platformChainCache;
    apiKeyResolver;
    constructor() {
        this.server = new Server({
            name: "solidityscan-mcp-server",
            version: "1.0.0",
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupToolHandlers();
    }
    getServer() {
        return this.server;
    }
    setApiKeyResolver(resolver) {
        this.apiKeyResolver = resolver;
    }
    resolveContextApiKey(extra) {
        if (!this.apiKeyResolver) {
            return undefined;
        }
        return this.apiKeyResolver(extra);
    }
    setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            const platformChain = await this.loadPlatformChain();
            const platformEnum = platformChain.platforms;
            const chainEnum = platformChain.chains;
            return {
                tools: [
                    {
                        name: "scan_contract",
                        description: "Scan a deployed smart contract by address for security vulnerabilities",
                        inputSchema: {
                            type: "object",
                            properties: {
                                contractAddress: {
                                    type: "string",
                                    description: "The deployed contract address to scan",
                                },
                                chain: {
                                    type: "string",
                                    description: "Chain name supported for the selected platform (from get_supported_platforms_chains).",
                                    enum: chainEnum,
                                },
                                platform: {
                                    type: "string",
                                    description: "Explorer/platform name (from get_supported_platforms_chains).",
                                    enum: platformEnum,
                                },
                                apiToken: {
                                    type: "string",
                                    description: "SolidityScan API token (optional if set in headers or environment)",
                                },
                            },
                            required: ["contractAddress", "chain"],
                        },
                    },
                    {
                        name: "scan_and_get_report_pdf",
                        description: "Scan a deployed contract, then generate and return a PDF report (basic scaffold)",
                        inputSchema: {
                            type: "object",
                            properties: {
                                contractAddress: {
                                    type: "string",
                                    description: "The deployed contract address to scan",
                                },
                                chain: {
                                    type: "string",
                                    description: "Chain name supported for the selected platform (from get_supported_platforms_chains).",
                                    enum: chainEnum,
                                },
                                platform: {
                                    type: "string",
                                    description: "Explorer/platform name (from get_supported_platforms_chains).",
                                    enum: platformEnum,
                                },
                                reportOptions: {
                                    type: "object",
                                    description: "Optional report generation options to forward to the SDK",
                                },
                                apiToken: {
                                    type: "string",
                                    description: "SolidityScan API token",
                                },
                            },
                            required: ["contractAddress", "chain"],
                        },
                    },
                    {
                        name: "get_supported_platforms_chains",
                        description: "Return supported platforms and their chains (names mapped to IDs) derived from platform-chain.json",
                        inputSchema: {
                            type: "object",
                            properties: {},
                            required: [],
                        },
                    },
                    {
                        name: "scan_project",
                        description: "Scan a Git repository project for security vulnerabilities",
                        inputSchema: {
                            type: "object",
                            properties: {
                                provider: {
                                    type: "string",
                                    description: "Git provider (e.g., github, gitlab)",
                                },
                                projectUrl: {
                                    type: "string",
                                    description: "Full URL to the git repository",
                                },
                                projectName: {
                                    type: "string",
                                    description: "Name for the project scan",
                                },
                                projectBranch: {
                                    type: "string",
                                    description: "Branch to scan",
                                    default: "main",
                                },
                                recurScans: {
                                    type: "boolean",
                                    description: "Enable recurring scans",
                                    default: false,
                                },
                                skipFilePaths: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "File paths to skip during scanning",
                                    default: [],
                                },
                                apiToken: {
                                    type: "string",
                                    description: "SolidityScan API token",
                                },
                            },
                            required: ["provider", "projectUrl", "projectName"],
                        },
                    },
                    {
                        name: "scan_local_directory",
                        description: "Scan a local directory containing Solidity files",
                        inputSchema: {
                            type: "object",
                            properties: {
                                directoryPath: {
                                    type: "string",
                                    description: "Path to local directory containing Solidity files",
                                },
                                projectName: {
                                    type: "string",
                                    description: "Name for the local project scan",
                                    default: "LocalScan",
                                },
                                apiToken: {
                                    type: "string",
                                    description: "SolidityScan API token",
                                },
                            },
                            required: ["directoryPath"],
                        },
                    },
                    {
                        name: "scan_file_content",
                        description: "Scan Solidity source code content directly",
                        inputSchema: {
                            type: "object",
                            properties: {
                                fileContent: {
                                    type: "string",
                                    description: "Raw Solidity contract source code to scan",
                                },
                                fileName: {
                                    type: "string",
                                    description: "Name for the contract file",
                                    default: "Contract.sol",
                                },
                                projectName: {
                                    type: "string",
                                    description: "Name for the scan project",
                                    default: "InlineScan",
                                },
                                apiToken: {
                                    type: "string",
                                    description: "SolidityScan API token",
                                },
                            },
                            required: ["fileContent"],
                        },
                    },
                ],
            };
        });
        this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
            const { name, arguments: rawArgs } = request.params;
            if (!rawArgs) {
                throw new Error("Missing arguments in tool call");
            }
            const args = { ...rawArgs };
            const contextApiKey = this.resolveContextApiKey(extra);
            if (contextApiKey && !args.apiToken) {
                args.apiToken = contextApiKey;
            }
            try {
                switch (name) {
                    case "scan_contract":
                        return await this.scanContract(args);
                    case "get_supported_platforms_chains":
                        return await this.getSupportedPlatformsChains();
                    case "scan_project":
                        return await this.scanProject(args);
                    case "scan_local_directory":
                        return await this.scanLocalDirectory(args);
                    case "scan_file_content":
                        return await this.scanFileContent(args);
                    case "scan_and_get_report_pdf":
                        return await this.scanAndGetReportPDF(args);
                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error executing ${name}: ${JSON.stringify(errorMessage)}`,
                        },
                    ],
                    isError: true,
                };
            }
        });
    }
    async scanAndGetReportPDF(args) {
        const { contractAddress, chain, platform, reportOptions, apiToken } = ScanAndGetReportPDFSchema.parse(args);
        const token = this.getApiToken(apiToken);
        const resolved = await this.resolvePlatformAndChain(platform, chain);
        const scanPayload = {
            contract_address: contractAddress,
            contract_chain: resolved.chainName,
            contract_platform: resolved.platformName,
        };
        const scanResults = await solidityscan.quickScanContract(scanPayload, token, false);
        const { project_id, scan_id } = scanResults;
        const reportPayload = {
            project_id: project_id || "",
            scan_id: scan_id || "",
            scan_type: "block",
        };
        if (reportOptions) {
            reportPayload.report_options = reportOptions;
        }
        const pdfInfo = await solidityscan.generateReport(reportPayload, token, false);
        const pdfUrl = `https://solidityscan.com/qs-report/${pdfInfo.project_id}/${pdfInfo.report_id}/${pdfInfo.scan_id}`;
        return {
            content: [
                {
                    type: "text",
                    text: `# Scan and Report PDF\n\n**Contract:** ${contractAddress}\n**Platform:** ${resolved.platformName}\n**Chain:** ${resolved.chainName}\n\n## PDF Link\n\n${pdfUrl}\n\n`,
                },
            ],
        };
    }
    getApiToken(providedToken) {
        const token = providedToken || process.env.SOLIDITYSCAN_API_KEY;
        if (!token) {
            throw new Error("No API token provided. Please set SOLIDITYSCAN_API_KEY environment variable, add the token to request arguments, or send it via headers.");
        }
        return token;
    }
    async scanContract(args) {
        const { contractAddress, chain, platform, apiToken } = ScanContractSchema.parse(args);
        const token = this.getApiToken(apiToken);
        const resolved = await this.resolvePlatformAndChain(platform, chain);
        const payload = {
            contract_address: contractAddress,
            contract_chain: resolved.chainName,
            contract_platform: resolved.platformName,
        };
        const results = await solidityscan.contractScan(payload, token, false);
        return {
            content: [
                {
                    type: "text",
                    text: `# Contract Scan Results\n\n**Contract:** ${contractAddress}\n**Platform:** ${resolved.platformName}\n**Chain:** ${resolved.chainName}\n\n## Scan Results:\n\n\`\`\`json\n${JSON.stringify(results, null, 2)}\n\`\`\``,
                },
            ],
        };
    }
    async scanProject(args) {
        const { provider, projectUrl, projectName, projectBranch, recurScans, skipFilePaths, apiToken } = ScanProjectSchema.parse(args);
        const token = this.getApiToken(apiToken);
        const payload = {
            provider,
            project_url: projectUrl,
            project_name: projectName,
            project_branch: projectBranch,
            recur_scans: recurScans,
            skip_file_paths: skipFilePaths,
        };
        const results = await solidityscan.projectScan(payload, token, false);
        return {
            content: [
                {
                    type: "text",
                    text: `# Project Scan Results\n\n**Project:** ${projectName}\n**URL:** ${projectUrl}\n**Branch:** ${projectBranch}\n\n## Scan Results:\n\n\`\`\`json\n${JSON.stringify(results, null, 2)}\n\`\`\``,
                },
            ],
        };
    }
    async loadPlatformChain() {
        if (this.platformChainCache) {
            return this.platformChainCache;
        }
        try {
            const response = await fetch("https://api.solidityscan.com/api-get-platform-chain-ids/");
            if (!response.ok) {
                throw new Error(`Failed to fetch platform/chain ids. Status: ${response.status}`);
            }
            const json = (await response.json());
            const data = json?.data;
            if (!data || typeof data !== "object") {
                throw new Error("Invalid platformChainData: missing data object");
            }
            const dataByPlatformName = {};
            const dataByPlatformId = {};
            const platforms = Object.keys(data);
            const chainNameSet = new Set();
            for (const platformName of platforms) {
                const entry = data[platformName];
                const chainsByName = {};
                for (const obj of entry.chains || []) {
                    const [name, id] = Object.entries(obj)[0] || [];
                    if (name) {
                        chainsByName[name] = id ?? null;
                        chainNameSet.add(name);
                    }
                }
                dataByPlatformName[platformName] = { id: entry.id, chainsByName };
                dataByPlatformId[entry.id] = platformName;
            }
            const chains = Array.from(chainNameSet).sort();
            const cache = { platforms: platforms.sort(), chains, dataByPlatformName, dataByPlatformId };
            this.platformChainCache = cache;
            return cache;
        }
        catch (err) {
            originalConsoleError("Failed to load platformChainData", err);
            const empty = {
                platforms: [],
                chains: [],
                dataByPlatformName: {},
                dataByPlatformId: {},
            };
            this.platformChainCache = empty;
            return empty;
        }
    }
    async resolvePlatformAndChain(platformInput, chainInput) {
        const index = await this.loadPlatformChain();
        if (!platformInput) {
            throw new Error("platform is required. Use a supported platform name or ID from get_supported_platforms_chains.");
        }
        if (!chainInput) {
            throw new Error("chain is required. Use a supported chain name or ID from get_supported_platforms_chains.");
        }
        let platformName = "";
        let platformId = "";
        if (index.dataByPlatformName[platformInput]) {
            platformName = platformInput;
            platformId = index.dataByPlatformName[platformInput].id;
        }
        else if (index.dataByPlatformId[platformInput]) {
            platformId = platformInput;
            platformName = index.dataByPlatformId[platformInput];
        }
        else {
            throw new Error(`Unsupported platform: ${platformInput}. Use get_supported_platforms_chains to see allowed values.`);
        }
        const chainsByName = index.dataByPlatformName[platformName]?.chainsByName || {};
        let chainName = "";
        let chainId = null;
        if (chainsByName[chainInput] !== undefined) {
            chainName = chainInput;
            chainId = chainsByName[chainInput] ?? null;
        }
        else {
            const found = Object.entries(chainsByName).find(([name, id]) => String(id) === String(chainInput));
            if (found) {
                chainName = found[0];
                chainId = found[1] ?? null;
            }
            else {
                const available = Object.keys(chainsByName).join(", ");
                throw new Error(`Unsupported chain: ${chainInput} for platform ${platformName}. Available chains: ${available}`);
            }
        }
        return { platformId, platformName, chainId, chainName };
    }
    async getSupportedPlatformsChains() {
        const index = await this.loadPlatformChain();
        const out = {};
        for (const [platformName, { id, chainsByName }] of Object.entries(index.dataByPlatformName)) {
            out[platformName] = { id, chains: chainsByName };
        }
        return {
            content: [
                {
                    type: "text",
                    text: `# Supported Platforms and Chains\n\n\`\`\`json\n${JSON.stringify(out, null, 2)}\n\`\`\``,
                },
            ],
        };
    }
    async scanLocalDirectory(args) {
        const { directoryPath, projectName, apiToken } = ScanLocalDirectorySchema.parse(args);
        const token = this.getApiToken(apiToken);
        try {
            await fs.access(directoryPath);
        }
        catch {
            throw new Error(`Directory not found: ${directoryPath}`);
        }
        const results = await solidityscan.analyseProject(directoryPath, token, projectName);
        return {
            content: [
                {
                    type: "text",
                    text: `# Local Directory Scan Results\n\n**Directory:** ${directoryPath}\n**Project Name:** ${projectName}\n\n## Scan Results:\n\n\`\`\`json\n${JSON.stringify(results, null, 2)}\n\`\`\``,
                },
            ],
        };
    }
    async scanFileContent(args) {
        const { fileContent, fileName, projectName, apiToken } = ScanFileContentSchema.parse(args);
        const token = this.getApiToken(apiToken);
        const tempDir = await fs.mkdtemp(path.join(tmpdir(), "solidityscan-"));
        const tempFilePath = path.join(tempDir, fileName);
        try {
            await fs.writeFile(tempFilePath, fileContent);
            const results = await solidityscan.analyseProject(tempDir, token, projectName);
            return {
                content: [
                    {
                        type: "text",
                        text: `# File Content Scan Results\n\n**File:** ${fileName}\n**Project Name:** ${projectName}\n\n## Scan Results:\n\n\`\`\`json\n${JSON.stringify(results, null, 2)}\n\`\`\``,
                    },
                ],
            };
        }
        finally {
            try {
                await fs.unlink(tempFilePath);
                await fs.rmdir(tempDir);
            }
            catch {
                // ignore cleanup errors
            }
        }
    }
}
//# sourceMappingURL=server-core.js.map