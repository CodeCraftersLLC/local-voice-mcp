import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TTSTools, TTSToolSchemas } from "./tools";
import { logger } from "../utils/logger";

/**
 * MCP Server for Local Voice TTS
 * Exposes TTS functionality as MCP tools
 */
export class LocalVoiceMCPServer {
  private server: McpServer;
  private ttsTools: TTSTools;

  constructor() {
    this.server = new McpServer({
      name: "local-voice-mcp",
      version: "0.1.0",
    });

    this.ttsTools = new TTSTools();
    this.setupTools();
    this.setupResources();
  }

  /**
   * Setup MCP tools
   */
  private setupTools() {
    // Text-to-Speech synthesis tool
    this.server.tool(
      "synthesize_text",
      TTSToolSchemas.synthesizeText,
      async (params) => {
        return await this.ttsTools.synthesizeText(params);
      }
    );

    // Audio playback tool
    this.server.tool("play_audio", TTSToolSchemas.playAudio, async (params) => {
      return await this.ttsTools.playAudio(params);
    });

    // TTS service status tool
    this.server.tool("tts_status", TTSToolSchemas.getStatus, async () => {
      return await this.ttsTools.getStatus();
    });
  }

  /**
   * Setup MCP resources
   */
  private setupResources() {
    // Service information resource
    this.server.resource(
      "service-info",
      "local-voice://service-info",
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                name: "Local Voice MCP",
                version: "0.1.0",
                description: "Text-to-Speech service using Chatterbox TTS",
                capabilities: [
                  "Text-to-speech synthesis",
                  "Voice cloning with reference audio",
                  "Prosody controls (exaggeration, cfg_weight)",
                ],
                status: "operational",
                tools: [
                  {
                    name: "synthesize_text",
                    description:
                      "Convert text to speech with optional voice cloning",
                    parameters: [
                      "text",
                      "referenceAudio",
                      "exaggeration",
                      "cfg_weight",
                    ],
                  },
                  {
                    name: "play_audio",
                    description:
                      "Play an audio file using the system's default audio player",
                    parameters: ["audioFile"],
                  },
                  {
                    name: "tts_status",
                    description: "Get the current status of the TTS service",
                    parameters: [],
                  },
                ],
                timestamp: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
      })
    );
  }

  /**
   * Initialize the TTS service
   */
  async initialize(): Promise<void> {
    logger.log("Initializing Local Voice MCP Server...");
    try {
      await this.ttsTools.ensureReady();
      logger.log("TTS service initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize TTS service:", error);
      throw error;
    }
  }

  /**
   * Start the MCP server with stdio transport
   */
  async start(): Promise<void> {
    await this.initialize();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    logger.log("Local Voice MCP Server started and ready for connections");
  }

  /**
   * Get the underlying MCP server instance
   */
  getServer(): McpServer {
    return this.server;
  }
}

/**
 * Create and start the MCP server
 */
export async function createMCPServer(): Promise<LocalVoiceMCPServer> {
  const mcpServer = new LocalVoiceMCPServer();
  await mcpServer.start();
  return mcpServer;
}
