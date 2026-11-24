import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getQuietModeStatus,
  getUserConfigPath,
  loadUserConfig,
  loadUserConfigStrict,
  normalizeUserConfig,
  parseIsoTimestampUtc,
} from "../../src/utils/user-config";

describe("user-config", () => {
  let tempDir: string;
  let configPath: string;
  const originalEnv = process.env.LOCAL_VOICE_MCP_CONFIG;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lvmcp-cfg-test-"));
    configPath = path.join(tempDir, "config.json");
    process.env.LOCAL_VOICE_MCP_CONFIG = configPath;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.LOCAL_VOICE_MCP_CONFIG = originalEnv;
    } else {
      delete process.env.LOCAL_VOICE_MCP_CONFIG;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("resolves custom config path from LOCAL_VOICE_MCP_CONFIG", () => {
    expect(getUserConfigPath()).toBe(path.resolve(configPath));
  });

  it("expands leading ~ in LOCAL_VOICE_MCP_CONFIG to match Python expanduser", () => {
    process.env.LOCAL_VOICE_MCP_CONFIG = "~/voice-test/config.json";
    expect(getUserConfigPath()).toBe(
      path.resolve(path.join(os.homedir(), "voice-test", "config.json"))
    );
  });

  it("returns empty object when config file does not exist", () => {
    expect(loadUserConfig()).toEqual({});
    expect(loadUserConfigStrict()).toEqual({});
    expect(getQuietModeStatus()).toEqual({ active: false });
  });

  it("detects manual quietMode=true", () => {
    fs.writeFileSync(configPath, JSON.stringify({ quietMode: true }), "utf-8");
    const status = getQuietModeStatus();
    expect(status.active).toBe(true);
    expect(status.reason).toBe("Quiet Mode is enabled");
  });

  it("detects active temporary snooze (quietUntil in future)", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    fs.writeFileSync(
      configPath,
      JSON.stringify({ quietMode: false, quietUntil: future }),
      "utf-8"
    );
    const status = getQuietModeStatus();
    expect(status.active).toBe(true);
    expect(status.quietUntil).toBe(future);
  });

  it("ignores expired temporary snooze (quietUntil in past)", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    fs.writeFileSync(
      configPath,
      JSON.stringify({ quietMode: false, quietUntil: past }),
      "utf-8"
    );
    const status = getQuietModeStatus();
    expect(status.active).toBe(false);
  });

  it("handles quietUntil boundary equal to nowMs as inactive", () => {
    const fixedIso = "2026-11-24T12:00:00.000Z";
    const fixedMs = Date.parse(fixedIso);
    expect(
      getQuietModeStatus({ quietMode: false, quietUntil: fixedIso }, fixedMs)
    ).toEqual({ active: false });
  });

  it("ignores unparseable quietUntil strings", () => {
    expect(
      getQuietModeStatus({ quietMode: false, quietUntil: "not-a-date" }, 1000)
    ).toEqual({ active: false });
  });

  it("normalizes timezone-less ISO quietUntil values to UTC consistently with Python", () => {
    const naiveIso = "2026-11-24T12:00:00";
    expect(parseIsoTimestampUtc(naiveIso)).toBe(
      Date.parse("2026-11-24T12:00:00Z")
    );
    const beforeMs = Date.parse("2026-11-24T11:59:59Z");
    const afterMs = Date.parse("2026-11-24T12:00:01Z");
    expect(
      getQuietModeStatus({ quietMode: false, quietUntil: naiveIso }, beforeMs)
        .active
    ).toBe(true);
    expect(
      getQuietModeStatus({ quietMode: false, quietUntil: naiveIso }, afterMs)
        .active
    ).toBe(false);
  });

  it("handles malformed JSON, array roots, and null roots gracefully", () => {
    fs.writeFileSync(configPath, "{not valid json", "utf-8");
    expect(loadUserConfig()).toEqual({});
    expect(getQuietModeStatus()).toEqual({ active: false });
    expect(() => loadUserConfigStrict()).toThrow(/Invalid JSON/);

    fs.writeFileSync(configPath, "[1, 2, 3]", "utf-8");
    expect(loadUserConfig()).toEqual({});
    expect(() => loadUserConfigStrict()).toThrow(/expected a JSON object/);

    fs.writeFileSync(configPath, "null", "utf-8");
    expect(loadUserConfig()).toEqual({});
    expect(() => loadUserConfigStrict()).toThrow(/expected a JSON object/);
  });

  it("validates and strips invalid field types during normalization", () => {
    const normalized = normalizeUserConfig({
      quietMode: "yes",
      quietUntil: "invalid-date",
      volume: 150,
      useMaleVoice: "true",
    });
    expect(normalized).toEqual({});

    const valid = normalizeUserConfig({
      quietMode: true,
      quietUntil: "2026-11-24T12:00:00Z",
      volume: 0,
      useMaleVoice: false,
    });
    expect(valid).toEqual({
      quietMode: true,
      quietUntil: "2026-11-24T12:00:00Z",
      volume: 0,
      useMaleVoice: false,
    });
  });
});
