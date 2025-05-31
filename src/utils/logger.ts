/**
 * Logger utility that respects MCP stdio communication
 * In MCP mode, logs go to stderr to avoid interfering with JSON communication
 * In HTTP mode, logs go to stdout normally
 */

const isMcpMode = () => process.env.MCP_MODE !== "http";

const sanitizeLogInput = (input: any): string => {
  if (typeof input === "string") {
    return input.replace(/\r|\n/g, " ");
  }
  return String(input).replace(/\r|\n/g, " ");
};

const formatLogArgs = (args: any[]): string => {
  return args
    .map((arg) => {
      if (arg instanceof Error) {
        return JSON.stringify({
          name: arg.name,
          message: arg.message,
          stack: arg.stack,
        });
      } else if (typeof arg === "object" && arg !== null) {
        try {
          return JSON.stringify(arg);
        } catch (e) {
          return String(arg);
        }
      } else {
        return String(arg);
      }
    })
    .join(" ");
};

const createLogEntry = (level: string, message: string, ...args: any[]) => {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    message: sanitizeLogInput(message),
    ...(args.length > 0 && {
      data: args.map((arg) => {
        if (arg instanceof Error) {
          return {
            name: arg.name,
            message: arg.message,
            stack: arg.stack,
          };
        } else if (typeof arg === "object" && arg !== null) {
          try {
            return arg;
          } catch (e) {
            return String(arg);
          }
        } else {
          return arg;
        }
      }),
    }),
  };

  return JSON.stringify(logEntry);
};

export const logger = {
  log: (message: string, ...args: any[]) => {
    if (isMcpMode()) {
      // In MCP mode, output JSON format to stderr
      process.stderr.write(createLogEntry("log", message, ...args) + "\n");
    } else {
      // In HTTP mode, use normal console.log
      console.log(message, ...args);
    }
  },

  error: (message: string, ...args: any[]) => {
    if (isMcpMode()) {
      process.stderr.write(createLogEntry("error", message, ...args) + "\n");
    } else {
      console.error(message, ...args);
    }
  },

  warn: (message: string, ...args: any[]) => {
    if (isMcpMode()) {
      process.stderr.write(createLogEntry("warn", message, ...args) + "\n");
    } else {
      console.warn(message, ...args);
    }
  },

  info: (message: string, ...args: any[]) => {
    if (isMcpMode()) {
      process.stderr.write(createLogEntry("info", message, ...args) + "\n");
    } else {
      console.info(message, ...args);
    }
  },
};
