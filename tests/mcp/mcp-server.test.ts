import { LocalVoiceMCPServer } from "../../src/mcp/mcp-server";

// Mock the MCP SDK
jest.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: jest.fn().mockImplementation(() => ({
    tool: jest.fn(),
    resource: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: jest.fn(),
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

describe("LocalVoiceMCPServer", () => {
  let mcpServer: LocalVoiceMCPServer;
  let mockMcpServerInstance: any;
  let mockTtsTools: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mcpServer = new LocalVoiceMCPServer();
    mockMcpServerInstance = (mcpServer as any).server;
    mockTtsTools = (mcpServer as any).ttsTools;
  });

  describe("constructor", () => {
    it("should initialize with correct name and version", () => {
      const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");

      expect(McpServer).toHaveBeenCalledWith({
        name: "local-voice-mcp",
        version: "0.1.0",
      });
    });

    it("should setup tools and resources", () => {
      expect(mockMcpServerInstance.tool).toHaveBeenCalledTimes(3);
      expect(mockMcpServerInstance.resource).toHaveBeenCalledTimes(1);
    });
  });

  describe("initialize", () => {
    it("should initialize TTS tools successfully", async () => {
      await mcpServer.initialize();

      expect(mockTtsTools.ensureReady).toHaveBeenCalled();
    });

    it("should handle initialization failure", async () => {
      mockTtsTools.ensureReady.mockRejectedValue(new Error("Init failed"));

      await expect(mcpServer.initialize()).rejects.toThrow("Init failed");
    });
  });

  describe("start", () => {
    it("should start the server successfully", async () => {
      const {
        StdioServerTransport,
      } = require("@modelcontextprotocol/sdk/server/stdio.js");

      await mcpServer.start();

      expect(mockTtsTools.ensureReady).toHaveBeenCalled();
      expect(StdioServerTransport).toHaveBeenCalled();
      expect(mockMcpServerInstance.connect).toHaveBeenCalled();
    });
  });

  describe("getServer", () => {
    it("should return the underlying MCP server instance", () => {
      const server = mcpServer.getServer();
      expect(server).toBe(mockMcpServerInstance);
    });
  });

  describe("tool handlers", () => {
    it("should register synthesize_text tool", () => {
      expect(mockMcpServerInstance.tool).toHaveBeenCalledWith(
        "synthesize_text",
        expect.any(Object),
        expect.any(Function)
      );
    });

    it("should register tts_status tool", () => {
      expect(mockMcpServerInstance.tool).toHaveBeenCalledWith(
        "tts_status",
        expect.any(Object),
        expect.any(Function)
      );
    });
  });

  describe("resource handlers", () => {
    it("should register service-info resource", () => {
      expect(mockMcpServerInstance.resource).toHaveBeenCalledWith(
        "service-info",
        "local-voice://service-info",
        expect.any(Function)
      );
    });
  });
});

describe("createMCPServer", () => {
  it("should create and start an MCP server", async () => {
    const { createMCPServer } = require("../../src/mcp/mcp-server");

    const server = await createMCPServer();

    expect(server).toBeInstanceOf(LocalVoiceMCPServer);
  });
});
