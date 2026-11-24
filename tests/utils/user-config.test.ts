import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getQuietModeStatus,
  getUserConfigPath,
  loadUserConfig,
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

  it("returns empty object when config file does not exist", () => {
    expect(loadUserConfig()).toEqual({});
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

  it("handles malformed JSON gracefully", () => {
    fs.writeFileSync(configPath, "{not valid json", "utf-8");
    expect(loadUserConfig()).toEqual({});
    expect(getQuietModeStatus()).toEqual({ active: false });
  });
});
