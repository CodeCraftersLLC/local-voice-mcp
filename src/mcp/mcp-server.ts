#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { TTSTools, ALL_TOOLS, executeToolAndHandleErrors } from "./tools";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../utils/logger";

let version = "0.0.0-dev";
try {
  version = require("../package.json").version;
} catch (_e) {
  logger.warn("Failed to load package.json. Using dev version.");
}
// Create server with capabilities BEFORE setting up handlers
const server = new Server(
  {
    name: "local-voice-mcp",
    version,
  },
  {
    capabilities: {
      tools: {
        list: true,
        call: true,
      },
    },
  }
);

// Store server instance for shutdown handling
const serverInstance = server;

// Create TTS tools instance
const ttsTools = new TTSTools();

// Graceful shutdown handling
let shutdownInProgress = false;
const shutdownHook = async () => {
  logger.info("Closing MCP server...");
  try {
    // The Server class doesn't have a disconnect method, so we just log closure
    logger.info("MCP server closed");
  } catch (error) {
    logger.error(
      "Error closing MCP server:",
      error instanceof Error ? error.message : "Unknown error"
    );
  }

  logger.info("Cleaning up Chatterbox resources...");
  // Clean up Chatterbox resources (if needed)
  // Currently no explicit cleanup needed, but leaving as placeholder
};

// Initialize TTS service
async function initializeTTSService(): Promise<void> {
  logger.log("Initializing Local Voice MCP Server...");
  try {
    await ttsTools.ensureReady();
    logger.log("TTS service initialized successfully");
  } catch (error) {
    logger.error(
      "Failed to initialize TTS service:",
      error instanceof Error ? error.message : "Unknown error"
    );
    throw error;
  }
}

// Set up request handlers AFTER capabilities are configured
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: ALL_TOOLS,
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // Directly call the handler. It either returns a result object (success or isError:true)
  // OR it throws a tagged protocol error.
  return await executeToolAndHandleErrors(
    request.params.name,
    request.params.arguments || {},
    ttsTools
  );
  // SDK automatically handles:
  // - Wrapping the returned value (success data or isError:true object) in `result: { ... }`
  // - Catching re-thrown protocol errors and formatting the top-level `error: { ... }`
});

// Initialize and start the server
async function startServer(): Promise<void> {
  await initializeTTSService();

  const transport = new StdioServerTransport();
  try {
    await server.connect(transport);
    logger.log("Local Voice MCP Server started and ready for connections");
  } catch (error) {
    logger.error(
      "Failed to start MCP server:",
      error instanceof Error ? error.message : "Unknown error"
    );
    throw error;
  }
}

// Export for compatibility
export async function createMCPServer(): Promise<void> {
  await startServer();
}

// Start the server if this file is run directly
if (require.main === module) {
  startServer().catch((error) => {
    logger.error(
      "Failed to start MCP server:",
      error instanceof Error ? error.message : "Unknown error"
    );
    process.exit(1);
  });

  // Setup signal handlers for graceful shutdown
  const shutdownSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  shutdownSignals.forEach((signal) => {
    process.on(signal, async () => {
      if (shutdownInProgress) return;
      shutdownInProgress = true;

      logger.info(`Shutting down due to ${signal}...`);

      // Set timeout for forced shutdown
      const forceShutdownTimer = setTimeout(() => {
        logger.error("Forced shutdown after 10 seconds");
        process.exit(1);
      }, 10000);

      try {
        await shutdownHook();
        clearTimeout(forceShutdownTimer);
        logger.info("Server shut down gracefully.");
        process.exit(0);
      } catch (error) {
        logger.error(
          "Error during shutdown:",
          error instanceof Error ? error.message : "Unknown error"
        );
        process.exit(1);
      }
    });
  });
}
