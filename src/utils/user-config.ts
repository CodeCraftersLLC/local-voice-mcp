import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { logger } from "./logger";

export interface UserConfig {
  quietMode?: boolean;
  quietUntil?: string | null;
  volume?: number | null;
  useMaleVoice?: boolean | null;
}

export interface QuietModeStatus {
  active: boolean;
  reason?: string;
  quietUntil?: string;
}

/**
 * Resolve the path to the shared user configuration file.
 * Defaults to ~/.local-voice-mcp/config.json across macOS, Windows, and Linux.
 */
export function getUserConfigPath(): string {
  if (process.env.LOCAL_VOICE_MCP_CONFIG) {
    return path.resolve(process.env.LOCAL_VOICE_MCP_CONFIG);
  }
  return path.join(os.homedir(), ".local-voice-mcp", "config.json");
}

/**
 * Safely read and parse the user configuration file.
 * Returns an empty object if the file does not exist or cannot be parsed.
 */
export function loadUserConfig(): UserConfig {
  const configPath = getUserConfigPath();
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    if (typeof raw !== "string" || raw.trim().length === 0) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as UserConfig;
    }
    return {};
  } catch (error: any) {
    if (error && error.code === "ENOENT") {
      return {};
    }
    logger.warn(
      `Failed to read user config at ${configPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return {};
  }
}

/**
 * Determine whether Quiet Mode (manual toggle or temporary snooze) is currently active.
 */
export function getQuietModeStatus(
  config: UserConfig = loadUserConfig(),
  nowMs: number = Date.now()
): QuietModeStatus {
  if (config.quietMode === true) {
    return {
      active: true,
      reason: "Quiet Mode is enabled",
    };
  }

  if (typeof config.quietUntil === "string" && config.quietUntil.trim().length > 0) {
    const untilMs = Date.parse(config.quietUntil);
    if (!Number.isNaN(untilMs) && untilMs > nowMs) {
      return {
        active: true,
        reason: `Audio temporarily disabled until ${config.quietUntil}`,
        quietUntil: config.quietUntil,
      };
    }
  }

  return { active: false };
}
