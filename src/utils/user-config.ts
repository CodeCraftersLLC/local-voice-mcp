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

const ISO_DATE_PREFIX_REGEX = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/;
const ISO_WITHOUT_TZ_REGEX =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

/**
 * Expand a leading home-directory shorthand (~) to match Python's os.path.expanduser.
 */
function expandHomeDir(inputPath: string): string {
  if (
    inputPath === "~" ||
    inputPath.startsWith("~/") ||
    inputPath.startsWith("~\\")
  ) {
    return path.join(os.homedir(), inputPath.slice(1));
  }
  return inputPath;
}

/**
 * Resolve the path to the shared user configuration file.
 * Defaults to ~/.local-voice-mcp/config.json across macOS, Windows, and Linux.
 */
export function getUserConfigPath(): string {
  const override = process.env.LOCAL_VOICE_MCP_CONFIG;
  if (override) {
    return path.resolve(expandHomeDir(override));
  }
  return path.join(os.homedir(), ".local-voice-mcp", "config.json");
}

/**
 * Validate and normalize parsed config fields so callers never observe
 * invalid values (e.g. out-of-range volume or wrong types).
 */
export function normalizeUserConfig(raw: Record<string, unknown>): UserConfig {
  const normalized: UserConfig = {};

  if (typeof raw.quietMode === "boolean") {
    normalized.quietMode = raw.quietMode;
  }

  if (raw.quietUntil === null) {
    normalized.quietUntil = null;
  } else if (typeof raw.quietUntil === "string") {
    const trimmed = raw.quietUntil.trim();
    if (trimmed.length > 0 && !Number.isNaN(parseIsoTimestampUtc(trimmed))) {
      normalized.quietUntil = trimmed;
    }
  }

  if (raw.volume === null) {
    normalized.volume = null;
  } else if (
    typeof raw.volume === "number" &&
    Number.isInteger(raw.volume) &&
    raw.volume >= 0 &&
    raw.volume <= 100
  ) {
    normalized.volume = raw.volume;
  }

  if (raw.useMaleVoice === null || typeof raw.useMaleVoice === "boolean") {
    normalized.useMaleVoice = raw.useMaleVoice;
  }

  return normalized;
}

/**
 * Parse an ISO-8601 timestamp consistently with scripts/tray_app.py:
 * - Rejects impossible calendar dates (e.g., 2026-02-30) that Date.parse would roll forward.
 * - Normalizes timezone-less date-time strings to UTC rather than local time.
 */
export function parseIsoTimestampUtc(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) {
    return Number.NaN;
  }

  const dateMatch = ISO_DATE_PREFIX_REGEX.exec(trimmed);
  if (dateMatch) {
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    const checkDate = new Date(Date.UTC(year, month - 1, day));
    if (
      checkDate.getUTCFullYear() !== year ||
      checkDate.getUTCMonth() !== month - 1 ||
      checkDate.getUTCDate() !== day
    ) {
      return Number.NaN;
    }
  }

  const normalized = ISO_WITHOUT_TZ_REGEX.test(trimmed)
    ? `${trimmed.replace(" ", "T")}Z`
    : trimmed;
  return Date.parse(normalized);
}

/**
 * Read and parse the raw JSON object from the user configuration file strictly.
 * Returns {} if the file does not exist (ENOENT), but throws on read, JSON syntax,
 * or non-object root errors. Preserves all keys (including unknown keys) for safe
 * read-modify-write updates.
 */
export function loadRawUserConfigStrict(): Record<string, unknown> {
  const configPath = getUserConfigPath();
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch (error: any) {
    if (error && error.code === "ENOENT") {
      return {};
    }
    throw new Error(
      `Cannot read user config at ${configPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (typeof raw !== "string" || raw.trim().length === 0) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in user config at ${configPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Invalid user config at ${configPath}: expected a JSON object`
    );
  }

  return parsed as Record<string, unknown>;
}

/**
 * Read, parse, and normalize the user configuration file strictly.
 * Returns {} if the file does not exist (ENOENT). Throws on read, JSON syntax,
 * or non-object root errors; invalid individual field values are ignored during
 * normalization.
 */
export function loadUserConfigStrict(): UserConfig {
  return normalizeUserConfig(loadRawUserConfigStrict());
}

/**
 * Safely read and parse the user configuration file.
 * Returns an empty object if the file does not exist or cannot be parsed.
 */
export function loadUserConfig(): UserConfig {
  try {
    return loadUserConfigStrict();
  } catch (error) {
    logger.warn(
      error instanceof Error ? error.message : String(error)
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
    const untilMs = parseIsoTimestampUtc(config.quietUntil);
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
