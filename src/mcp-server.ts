#!/usr/bin/env node

import { spawn } from "child_process";
import * as path from "path";
import { createMCPServer } from "./mcp/mcp-server";
import { startApp } from "./server";
import getPort from "get-port";
import { logger } from "./utils/logger";

const MODE = (() => {
  const mode = (process.env.MCP_MODE || "mcp").toLowerCase();
  if (mode !== "mcp" && mode !== "http") {
    throw new Error("Invalid MCP_MODE environment variable");
  }
  return mode;
})();

/**
 * Get a port number, either from environment variable or find an available one
 */
async function getPortNumber(): Promise<number> {
  const envPort = process.env.PORT;

  if (envPort) {
    const port = Number.parseInt(envPort, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid PORT environment variable: ${envPort}`);
    }
    return port;
  }

  // No environment variable set, find an available port starting from 59125
  return await getPort({ port: 59125 });
}

function maybeStartTrayHelper(): void {
  if (process.env.ENABLE_TRAY?.toLowerCase() !== "true") {
    return;
  }
  try {
    const trayCliPath = path.join(__dirname, "tray-cli.js");
    const child = spawn(process.execPath, [trayCliPath, "--background"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    logger.info("Spawned background tray helper (ENABLE_TRAY=true)");
  } catch (error) {
    logger.warn(
      `Failed to auto-start tray helper: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function main() {
  logger.info(`Starting Local Voice MCP Server in ${MODE} mode...`);
  maybeStartTrayHelper();

  try {
    if (MODE === "http") {
      // Get an available port (from env var or find one automatically)
      const port = await getPortNumber();
      logger.info(`Starting HTTP server on port ${port}...`);
      await startApp(port);
    } else {
      // Start MCP server mode (default)
      logger.info("Starting MCP server with stdio transport...");
      await createMCPServer();
    }
  } catch (error) {
    logger.error("Failed to start Local Voice MCP server:", error);
    process.exit(1);
  }
}

// Graceful shutdown
const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
signals.forEach((signal) => {
  process.on(signal, () => {
    logger.info(
      `\nReceived ${signal}. Shutting down Local Voice MCP server...`
    );
    // Perform any cleanup here if necessary (e.g., server.close())
    // For Express, active connections might keep it alive briefly.
    // process.exit() will eventually terminate.
    // If chatterbox service or python script need explicit shutdown, add here.
    logger.info("Server shut down.");
    process.exit(0);
  });
});

main();
