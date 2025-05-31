#!/usr/bin/env node

import { createMCPServer } from "./mcp/mcp-server";
import { startApp } from "./server";

const PORT = parseInt(process.env.PORT || "59125", 10);
const MODE = process.env.MCP_MODE || "mcp"; // 'mcp' or 'http'

async function main() {
  console.log(`Starting Local Voice MCP Server in ${MODE} mode...`);

  try {
    if (MODE === "http") {
      // Start HTTP server mode
      console.log(`Starting HTTP server on port ${PORT}...`);
      await startApp(PORT);
    } else {
      // Start MCP server mode (default)
      console.log("Starting MCP server with stdio transport...");
      await createMCPServer();
    }
  } catch (error) {
    console.error("Failed to start Local Voice MCP server:", error);
    process.exit(1);
  }
}

// Graceful shutdown
const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
signals.forEach((signal) => {
  process.on(signal, () => {
    console.log(
      `\nReceived ${signal}. Shutting down Local Voice MCP server...`
    );
    // Perform any cleanup here if necessary (e.g., server.close())
    // For Express, active connections might keep it alive briefly.
    // process.exit() will eventually terminate.
    // If chatterbox service or python script need explicit shutdown, add here.
    console.log("Server shut down.");
    process.exit(0);
  });
});

main();
