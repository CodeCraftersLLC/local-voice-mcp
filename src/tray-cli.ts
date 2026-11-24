#!/usr/bin/env node

import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getQuietModeStatus,
  getUserConfigPath,
  loadUserConfig,
  UserConfig,
} from "./utils/user-config";

function resolvePythonPath(): string {
  return (
    process.env.TRAY_PYTHON_PATH ||
    process.env.PYTHON_PATH ||
    process.env.CHATTERBOX_PYTHON_PATH ||
    "python3"
  );
}

function getPidFilePath(): string {
  return path.join(path.dirname(getUserConfigPath()), "tray.pid");
}

function isPidRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getRunningTrayPid(): number | null {
  const pidFile = getPidFilePath();
  if (!fs.existsSync(pidFile)) {
    return null;
  }
  try {
    const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
    return isPidRunning(pid) ? pid : null;
  } catch {
    return null;
  }
}

function saveUserConfig(config: UserConfig): void {
  const configPath = getUserConfigPath();
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  const tmpPath = path.join(
    configDir,
    `.config-${process.pid}-${Date.now()}.json`
  );
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  fs.renameSync(tmpPath, configPath);
}

async function ensureTrayDependencies(pythonPath: string): Promise<void> {
  const hasDeps = await new Promise<boolean>((resolve) => {
    const check = spawn(pythonPath, ["-c", "import pystray, PIL"], {
      stdio: "ignore",
    });
    check.on("close", (code) => resolve(code === 0));
    check.on("error", () => resolve(false));
  });

  if (hasDeps) {
    return;
  }

  console.error(
    "[local-voice-mcp-tray] Installing Python tray dependencies (pystray, Pillow)..."
  );
  const requirementsPath = path.join(
    __dirname,
    "../scripts/requirements-tray.txt"
  );

  const runPip = (extraArgs: string[]): Promise<boolean> =>
    new Promise((resolve) => {
      const pip = spawn(
        pythonPath,
        ["-m", "pip", "install", "-q", ...extraArgs, "-r", requirementsPath],
        { stdio: "inherit" }
      );
      pip.on("close", (code) => resolve(code === 0));
      pip.on("error", () => resolve(false));
    });

  if (await runPip([])) {
    return;
  }
  // Fallback for PEP 668 externally-managed Python environments (e.g., Homebrew / Ubuntu 24.04)
  if (await runPip(["--user", "--break-system-packages"])) {
    return;
  }

  throw new Error(
    `Failed to install tray dependencies using ${pythonPath}. Run manually: ${pythonPath} -m pip install pystray Pillow`
  );
}

function printHelp(): void {
  console.log(`Usage: local-voice-mcp-tray [options]

Options:
  -d, --background     Launch the system tray / menu bar icon in the background
  --stop               Stop a running background tray icon process
  --status             Show current Quiet Mode, volume config, and tray PID status
  --quiet <on|off>     Enable or disable Quiet Mode from the command line
  --volume <0-100|default>  Set playback volume override (or 'default' to clear)
  --force              Replace existing tray instance if PID lock is held
  -h, --help           Show this help message
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("-h") || args.includes("--help")) {
    printHelp();
    return;
  }

  if (args.includes("--status")) {
    const config = loadUserConfig();
    const quiet = getQuietModeStatus(config);
    const trayPid = getRunningTrayPid();
    console.log(
      JSON.stringify(
        {
          trayRunning: trayPid !== null,
          trayPid,
          quietMode: quiet.active,
          ...(quiet.reason && { quietReason: quiet.reason }),
          ...(quiet.quietUntil && { quietUntil: quiet.quietUntil }),
          volume: config.volume ?? "default",
          useMaleVoice: config.useMaleVoice ?? "default",
          configFile: getUserConfigPath(),
          platform: os.platform(),
        },
        null,
        2
      )
    );
    return;
  }

  const quietIdx = args.indexOf("--quiet");
  if (quietIdx !== -1) {
    const val = (args[quietIdx + 1] || "").toLowerCase();
    if (val !== "on" && val !== "off") {
      console.error("Error: --quiet requires 'on' or 'off'");
      process.exit(1);
    }
    const config = loadUserConfig();
    config.quietMode = val === "on";
    config.quietUntil = null;
    saveUserConfig(config);
    console.log(`Quiet Mode ${config.quietMode ? "enabled" : "disabled"}.`);
    return;
  }

  const volIdx = args.indexOf("--volume");
  if (volIdx !== -1) {
    const raw = (args[volIdx + 1] || "").toLowerCase();
    const config = loadUserConfig();
    if (raw === "default" || raw === "reset") {
      config.volume = null;
      saveUserConfig(config);
      console.log("Playback volume reset to default.");
      return;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
      console.error("Error: --volume must be an integer 0-100 or 'default'");
      process.exit(1);
    }
    config.volume = parsed;
    saveUserConfig(config);
    console.log(`Playback volume set to ${parsed}%.`);
    return;
  }

  if (args.includes("--stop")) {
    const pid = getRunningTrayPid();
    if (!pid) {
      console.log("Local Voice MCP tray is not currently running.");
      return;
    }
    try {
      process.kill(pid, "SIGTERM");
      console.log(`Stopped Local Voice MCP tray (PID ${pid}).`);
    } catch (err) {
      console.error(
        `Failed to stop PID ${pid}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      process.exit(1);
    }
    return;
  }

  const force = args.includes("--force");
  const existingPid = getRunningTrayPid();
  if (existingPid && !force) {
    console.log(
      `Local Voice MCP tray is already running (PID ${existingPid}).`
    );
    return;
  }

  const pythonPath = resolvePythonPath();
  await ensureTrayDependencies(pythonPath);

  const scriptPath = path.join(__dirname, "../scripts/tray_app.py");
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Tray script not found at: ${scriptPath}`);
  }

  const pyArgs = [scriptPath, ...(force ? ["--force"] : [])];
  const background = args.includes("-d") || args.includes("--background");

  if (background) {
    const child = spawn(pythonPath, pyArgs, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    console.log(
      `Started Local Voice MCP tray in background (PID ${child.pid}).`
    );
    return;
  }

  const child = spawn(pythonPath, pyArgs, { stdio: "inherit" });
  child.on("close", (code) => {
    process.exit(code ?? 0);
  });
  child.on("error", (err) => {
    console.error(`Failed to start tray app: ${err.message}`);
    process.exit(1);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
