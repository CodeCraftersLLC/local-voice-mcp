/**
 * Logger utility that respects MCP stdio communication
 * In MCP mode, logs go to stderr to avoid interfering with JSON communication
 * In HTTP mode, logs go to stdout normally
 */

const isMcpMode = () => process.env.MCP_MODE !== "http";

/**
 * Sanitizes log input by removing control characters and ANSI escape sequences
 * - Removes all control characters (ASCII 0-31 and 127)
 * - Strips ANSI escape sequences used for terminal formatting
 * - Removes bidirectional override characters (U+202E, U+202C)
 * - Preserves valid text content
 */
const sanitizeLogInput = (input: any): string => {
  const normalise = (val: string) =>
    val
      .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "") // Remove ANSI escapes first
      .replace(/[\x00-\x1F\x7F\u202E\u202C]/g, " "); // Then replace control chars and bidirectional overrides

  return typeof input === "string"
    ? normalise(input)
    : normalise(String(input));
};

const createLogEntry = (level: string, message: string, ...args: any[]) => {
  const redact = (obj: any): any => {
    if (typeof obj === "object" && obj !== null) {
      if (Array.isArray(obj)) {
        return obj.map(redact);
      }
      const clone: any = {};
      for (const key of Object.keys(obj)) {
        if (/passw(or)?d|token|secret|api[_-]?key|authorization|auth/i.test(key)) {
          clone[key] = "[REDACTED]";
        } else {
          clone[key] = redact(obj[key]);
        }
      }
      return clone;
    }
    return obj;
  };

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
            // Do not log stack traces to avoid leaking sensitive info
          };
        } else if (typeof arg === "object" && arg !== null) {
          try {
            return redact(arg);
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
