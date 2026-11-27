#!/usr/bin/env node

import { spawn } from "child_process";
import * as fs from "fs";
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

export function maybeStartTrayHelper(): void {
  if (process.env.ENABLE_TRAY?.toLowerCase() !== "true") {
    return;
  }
  try {
    const compiledLocal = path.join(__dirname, "tray-cli.js");
    const compiledDist = path.resolve(__dirname, "../dist/tray-cli.js");
    const sourceTs = path.join(__dirname, "tray-cli.ts");

    let spawnArgs: string[];
    if (fs.existsSync(compiledLocal)) {
      spawnArgs = [compiledLocal, "--background"];
    } else if (fs.existsSync(compiledDist)) {
      spawnArgs = [compiledDist, "--background"];
    } else if (fs.existsSync(sourceTs)) {
      let tsNodeRegister: string;
      try {
        tsNodeRegister = require.resolve("ts-node/register", {
          paths: [__dirname],
        });
      } catch {
        logger.warn(
          "ts-node/register not found from repository root; run 'npm run build' or start local-voice-mcp-tray manually."
        );
        return;
      }
      spawnArgs = ["-r", tsNodeRegister, sourceTs, "--background"];
    } else {
      logger.warn(
        "Tray helper entrypoint not found; run 'npm run build' or start local-voice-mcp-tray manually."
      );
      return;
    }

    const child = spawn(process.execPath, spawnArgs, {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", (error) => {
      logger.warn(`Failed to launch tray helper: ${error.message}`);
    });
    child.on("exit", (code, signal) => {
      if (code === 0) {
        logger.info("Background tray helper started (ENABLE_TRAY=true)");
      } else if (signal) {
        logger.warn(
          `Tray helper terminated by signal ${signal}; run local-voice-mcp-tray --background in a terminal to see the error.`
        );
      } else if (code !== null) {
        logger.warn(
          `Tray helper exited with code ${code}; run local-voice-mcp-tray --background in a terminal to see the error.`
        );
      }
    });
    child.unref();
    logger.info("Starting background tray helper (ENABLE_TRAY=true)...");
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
if (require.main === module) {
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
}
