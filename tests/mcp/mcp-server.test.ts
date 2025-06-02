// Mock the MCP SDK
jest.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: jest.fn().mockImplementation(() => ({
    tool: jest.fn(),
    resource: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock TTSTools
jest.mock("../../src/mcp/tools", () => ({
  TTSTools: jest.fn().mockImplementation(() => ({
    ensureReady: jest.fn().mockResolvedValue(undefined),
    synthesizeText: jest.fn(),
    getStatus: jest.fn(),
  })),
  TTSToolSchemas: {
    synthesizeText: {
      text: { parse: jest.fn() },
      referenceAudio: { parse: jest.fn() },
      exaggeration: { parse: jest.fn() },
      cfg_weight: { parse: jest.fn() },
    },
    getStatus: {},
  },
}));

describe("createMCPServer", () => {
  it("should start an MCP server", async () => {
    const { createMCPServer } = require("../../src/mcp/mcp-server");

    await expect(createMCPServer()).resolves.toBeUndefined();
  });
});
