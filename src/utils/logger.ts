/**
 * Logger utility that respects MCP stdio communication
 * In MCP mode, logs go to stderr to avoid interfering with JSON communication
 * In HTTP mode, logs go to stdout normally
 */

const isMcpMode = process.env.MCP_MODE !== 'http';

export const logger = {
  log: (message: string, ...args: any[]) => {
    if (isMcpMode) {
      // In MCP mode, use stderr to avoid interfering with stdio JSON communication
      process.stderr.write(`[LOG] ${message}\n`);
      if (args.length > 0) {
        process.stderr.write(`[LOG] ${JSON.stringify(args)}\n`);
      }
    } else {
      // In HTTP mode, use normal console.log
      console.log(message, ...args);
    }
  },

  error: (message: string, ...args: any[]) => {
    if (isMcpMode) {
      process.stderr.write(`[ERROR] ${message}\n`);
      if (args.length > 0) {
        process.stderr.write(`[ERROR] ${JSON.stringify(args)}\n`);
      }
    } else {
      console.error(message, ...args);
    }
  },

  warn: (message: string, ...args: any[]) => {
    if (isMcpMode) {
      process.stderr.write(`[WARN] ${message}\n`);
      if (args.length > 0) {
        process.stderr.write(`[WARN] ${JSON.stringify(args)}\n`);
      }
    } else {
      console.warn(message, ...args);
    }
  },

  info: (message: string, ...args: any[]) => {
    if (isMcpMode) {
      process.stderr.write(`[INFO] ${message}\n`);
      if (args.length > 0) {
        process.stderr.write(`[INFO] ${JSON.stringify(args)}\n`);
      }
    } else {
      console.info(message, ...args);
    }
  }
};
