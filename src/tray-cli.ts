#!/usr/bin/env node

import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getQuietModeStatus,
  getUserConfigPath,
  loadRawUserConfigStrict,
  loadUserConfig,
} from "./utils/user-config";

interface RecordedPidInfo {
  pid: number;
  scriptPath?: string;
}

const PYTHON_BIN_REGEX = /^(python(\d+(\.\d+)*)?w?|py)(\.exe)?$/i;

function resolveInterpreterExecutable(candidate: string): string | null {
  const probe = spawnSync(
    candidate,
    ["-c", "import sys; print(sys.executable)"],
    { encoding: "utf-8", timeout: 5000 }
  );
  if (!probe.error && probe.status === 0 && typeof probe.stdout === "string") {
    const resolved = probe.stdout.trim();
    if (resolved.length > 0) {
      return resolved;
    }
    return candidate;
  }
  return null;
}

function resolvePythonPath(): string {
  const explicit =
    process.env.TRAY_PYTHON_PATH ||
    process.env.PYTHON_PATH ||
    process.env.CHATTERBOX_PYTHON_PATH;
  if (explicit) {
    // Resolve launchers/shims (e.g. py.exe on Windows) to the actual Python executable
    // so spawned child.pid matches the Python process writing tray.pid and the ready marker.
    return resolveInterpreterExecutable(explicit) || explicit;
  }

  const candidates =
    process.platform === "win32"
      ? ["python", "py", "python3"]
      : ["python3", "python"];

  for (const candidate of candidates) {
    const resolved = resolveInterpreterExecutable(candidate);
    if (resolved) {
      return resolved;
    }
  }

  return process.platform === "win32" ? "python" : "python3";
}

function getPidFilePath(): string {
  return path.join(path.dirname(getUserConfigPath()), "tray.pid");
}

function getTrayScriptPath(): string {
  const candidate = path.join(__dirname, "../scripts/tray_app.py");
  try {
    return fs.realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

function normalizePathForCompare(p: string): string {
  let resolved: string;
  try {
    resolved = fs.realpathSync(p);
  } catch {
    resolved = path.resolve(p);
  }
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function tokenizeCommandLine(cmdline: string): string[] {
  const tokens: string[] = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(cmdline)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function argvMatchesTray(argv: string[], expectedScriptPath: string): boolean {
  if (argv.length < 2) {
    return false;
  }

  const exeBase = path.basename(argv[0]);
  if (!PYTHON_BIN_REGEX.test(exeBase)) {
    return false;
  }

  const expectedNorm = normalizePathForCompare(expectedScriptPath);
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i];
    if (!token || token.startsWith("-")) {
      continue;
    }
    if (normalizePathForCompare(token) === expectedNorm) {
      return true;
    }
  }
  return false;
}

function rawArgsContainsScriptPath(
  rawArgs: string,
  expectedScriptPath: string
): boolean {
  if (!rawArgs) {
    return false;
  }
  const candidates = new Set<string>([
    expectedScriptPath,
    path.resolve(expectedScriptPath),
    getTrayScriptPath(),
  ]);
  try {
    candidates.add(fs.realpathSync(expectedScriptPath));
  } catch {
    // Ignore if path no longer exists
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(candidate)}(?:\\s|$)`);
    if (pattern.test(rawArgs)) {
      return true;
    }
  }
  return false;
}

function commandLineMatchesTray(
  cmdline: string,
  expectedScriptPath: string,
  comm?: string
): boolean {
  if (!cmdline.trim()) {
    return false;
  }
  if (comm !== undefined) {
    const exeBase = path.basename(comm.trim());
    if (!PYTHON_BIN_REGEX.test(exeBase)) {
      return false;
    }
    return rawArgsContainsScriptPath(cmdline, expectedScriptPath);
  }
  return argvMatchesTray(tokenizeCommandLine(cmdline.trim()), expectedScriptPath);
}

function isPidRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return Boolean(err && err.code === "EPERM");
  }
}

type ProcessIdentityCheck = "match" | "not_running" | "mismatch" | "unknown";

/**
 * Verify that a live PID is a Python interpreter running the expected tray_app.py
 * script before signaling it, preventing signals to unrelated processes (e.g. an
 * editor opened on tray_app.py) or after PID reuse, while preserving paths with spaces.
 */
function verifyTrayProcess(
  pid: number,
  expectedScriptPath?: string
): ProcessIdentityCheck {
  if (!isPidRunning(pid)) {
    return "not_running";
  }

  const targetScript = expectedScriptPath || getTrayScriptPath();

  try {
    if (process.platform === "win32") {
      const probe = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`,
        ],
        { encoding: "utf-8", timeout: 10000 }
      );
      if (probe.error || probe.status !== 0 || typeof probe.stdout !== "string") {
        return "unknown";
      }
      return commandLineMatchesTray(probe.stdout, targetScript)
        ? "match"
        : "mismatch";
    }

    // On Linux, /proc/<pid>/cmdline gives exact NUL-separated argv tokens (handles spaces)
    const procCmdline = `/proc/${pid}/cmdline`;
    if (process.platform === "linux" && fs.existsSync(procCmdline)) {
      try {
        const raw = fs.readFileSync(procCmdline);
        const argv = raw
          .toString("utf-8")
          .split("\0")
          .filter((part) => part.length > 0);
        if (argv.length > 0) {
          return argvMatchesTray(argv, targetScript) ? "match" : "mismatch";
        }
      } catch {
        // Fall through to ps probe
      }
    }

    // On macOS / BSD, query `comm=` for exact interpreter (handles spaces in exe path)
    // and `args=` for space-safe script path verification
    const commProbe = spawnSync("ps", ["-p", String(pid), "-o", "comm="], {
      encoding: "utf-8",
      timeout: 3000,
    });
    const argsProbe = spawnSync("ps", ["-p", String(pid), "-o", "args="], {
      encoding: "utf-8",
      timeout: 3000,
    });
    if (
      commProbe.error ||
      commProbe.status !== 0 ||
      typeof commProbe.stdout !== "string" ||
      argsProbe.error ||
      argsProbe.status !== 0 ||
      typeof argsProbe.stdout !== "string"
    ) {
      return "unknown";
    }
    return commandLineMatchesTray(argsProbe.stdout, targetScript, commProbe.stdout)
      ? "match"
      : "mismatch";
  } catch {
    return "unknown";
  }
}

function readRecordedPidInfo(): RecordedPidInfo | null {
  const pidFile = getPidFilePath();
  if (!fs.existsSync(pidFile)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(pidFile, "utf-8").trim();
    if (!raw) {
      return null;
    }
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw);
      if (
        typeof parsed?.pid === "number" &&
        Number.isInteger(parsed.pid) &&
        parsed.pid > 0
      ) {
        return {
          pid: parsed.pid,
          ...(typeof parsed.scriptPath === "string" && {
            scriptPath: parsed.scriptPath,
          }),
        };
      }
      return null;
    }
    const pid = parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? { pid } : null;
  } catch {
    return null;
  }
}

type RunningTrayProbe =
  | { status: "running"; info: RecordedPidInfo }
  | { status: "not_running" }
  | { status: "unknown"; info: RecordedPidInfo };

function probeRunningTray(): RunningTrayProbe {
  const info = readRecordedPidInfo();
  if (!info) {
    return { status: "not_running" };
  }
  const identity = verifyTrayProcess(info.pid, info.scriptPath);
  if (identity === "match") {
    return { status: "running", info };
  }
  if (identity === "unknown") {
    return { status: "unknown", info };
  }
  return { status: "not_running" };
}

function getRunningTrayInfo(): RecordedPidInfo | null {
  const probe = probeRunningTray();
  return probe.status === "running" ? probe.info : null;
}

async function stopTrayProcess(
  info: RecordedPidInfo,
  timeoutMs = 5000
): Promise<boolean> {
  const identity = verifyTrayProcess(info.pid, info.scriptPath);
  if (identity === "not_running") {
    return true;
  }
  if (identity !== "match") {
    throw new Error(
      `Refusing to signal PID ${info.pid}: could not verify it is the Local Voice MCP tray process (status: ${identity}).`
    );
  }

  try {
    process.kill(info.pid, "SIGTERM");
  } catch (err: any) {
    if (err && err.code === "ESRCH") {
      return true;
    }
    throw err;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidRunning(info.pid)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return !isPidRunning(info.pid);
}

function getConfigLockPath(): string {
  return path.join(path.dirname(getUserConfigPath()), "config.lock");
}

async function withConfigLock<T>(
  fn: () => T,
  timeoutMs = 5000,
  staleAfterMs = 15000
): Promise<T> {
  const lockPath = getConfigLockPath();
  const configDir = path.dirname(lockPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const deadline = Date.now() + timeoutMs;
  let fd: number | null = null;

  while (fd === null) {
    try {
      fd = fs.openSync(lockPath, "wx", 0o600);
      fs.writeSync(fd, `${process.pid}\n`);
    } catch (err: any) {
      if (err && err.code === "EEXIST") {
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > staleAfterMs) {
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch {
          // Lock disappeared concurrently; retry
        }
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for config lock at ${lockPath}`);
        }
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }
      throw err;
    }
  }

  try {
    return fn();
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // Ignore close errors
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Ignore unlink errors
    }
  }
}

function saveUserConfig(config: Record<string, unknown>): void {
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
  const packageArgs = fs.existsSync(requirementsPath)
    ? ["-r", requirementsPath]
    : ["pystray>=0.19.5", "Pillow>=10.0.0"];

  const runPip = (extraArgs: string[]): Promise<boolean> =>
    new Promise((resolve) => {
      const pip = spawn(
        pythonPath,
        ["-m", "pip", "install", "-q", ...extraArgs, ...packageArgs],
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
  -d, --background          Launch the system tray / menu bar icon in the background
  --stop                    Stop a running background tray icon process
  --status                  Show current Quiet Mode, volume config, and tray PID status
  --quiet <on|off>          Enable or disable Quiet Mode from the command line
  --volume <0-100|default>  Set playback volume override (or 'default' to clear)
  --force                   Terminate existing tray instance and start a replacement
  -h, --help                Show this help message
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
    const trayInfo = getRunningTrayInfo();
    console.log(
      JSON.stringify(
        {
          trayRunning: trayInfo !== null,
          trayPid: trayInfo?.pid ?? null,
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
    const enabled = val === "on";
    await withConfigLock(() => {
      const config = loadRawUserConfigStrict();
      config.quietMode = enabled;
      config.quietUntil = null;
      saveUserConfig(config);
    });
    console.log(`Quiet Mode ${enabled ? "enabled" : "disabled"}.`);
    return;
  }

  const volIdx = args.indexOf("--volume");
  if (volIdx !== -1) {
    const rawArg = args[volIdx + 1];
    if (rawArg === undefined || rawArg.trim() === "") {
      console.error("Error: --volume requires an integer 0-100 or 'default'");
      process.exit(1);
    }
    const raw = rawArg.trim().toLowerCase();
    if (raw === "default" || raw === "reset") {
      await withConfigLock(() => {
        const config = loadRawUserConfigStrict();
        config.volume = null;
        saveUserConfig(config);
      });
      console.log("Playback volume reset to default.");
      return;
    }
    const parsed = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
      console.error("Error: --volume must be an integer 0-100 or 'default'");
      process.exit(1);
    }
    await withConfigLock(() => {
      const config = loadRawUserConfigStrict();
      config.volume = parsed;
      saveUserConfig(config);
    });
    console.log(`Playback volume set to ${parsed}%.`);
    return;
  }

  if (args.includes("--stop")) {
    const probe = probeRunningTray();
    if (probe.status === "not_running") {
      console.log("Local Voice MCP tray is not currently running.");
      return;
    }
    if (probe.status === "unknown") {
      console.error(
        `Failed to verify whether live PID ${probe.info.pid} is the Local Voice MCP tray; refusing to send signal.`
      );
      process.exit(1);
    }
    const trayInfo = probe.info;
    try {
      const stopped = await stopTrayProcess(trayInfo);
      if (stopped) {
        console.log(`Stopped Local Voice MCP tray (PID ${trayInfo.pid}).`);
      } else {
        console.error(
          `Timed out waiting for Local Voice MCP tray (PID ${trayInfo.pid}) to stop.`
        );
        process.exit(1);
      }
    } catch (err) {
      console.error(
        `Failed to stop PID ${trayInfo.pid}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      process.exit(1);
    }
    return;
  }

  const force = args.includes("--force");
  const initialProbe = probeRunningTray();
  if (initialProbe.status === "unknown") {
    throw new Error(
      `Could not verify whether live PID ${initialProbe.info.pid} is the Local Voice MCP tray.`
    );
  }
  if (initialProbe.status === "running") {
    const existingInfo = initialProbe.info;
    if (!force) {
      console.log(
        `Local Voice MCP tray is already running (PID ${existingInfo.pid}).`
      );
      return;
    }
    const stopped = await stopTrayProcess(existingInfo);
    if (!stopped) {
      throw new Error(
        `Timed out waiting for existing tray instance (PID ${existingInfo.pid}) to exit.`
      );
    }
  }

  const pythonPath = resolvePythonPath();
  await ensureTrayDependencies(pythonPath);

  const scriptPath = path.join(__dirname, "../scripts/tray_app.py");
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Tray script not found at: ${scriptPath}`);
  }

  const background = args.includes("-d") || args.includes("--background");

  if (background) {
    const readyDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "local-voice-mcp-tray-")
    );
    try {
      fs.chmodSync(readyDir, 0o700);
    } catch {
      // Best-effort permission hardening (no-op on Windows)
    }
    const readyFile = path.join(readyDir, "ready");
    const pyArgs = [
      scriptPath,
      "--ready-file",
      readyFile,
      ...(force ? ["--force"] : []),
    ];

    const child = spawn(pythonPath, pyArgs, {
      detached: true,
      stdio: "ignore",
    });

    type StartupResult =
      | { outcome: "started"; pid: number }
      | { outcome: "already_running" };
    const startupTimeoutMs = force ? 15000 : 10000;

    const terminateHungChild = async (): Promise<void> => {
      const childPid = child.pid;
      const isLiveChild = (): boolean =>
        childPid !== undefined &&
        child.exitCode === null &&
        child.signalCode === null &&
        isPidRunning(childPid);

      if (!isLiveChild()) {
        return;
      }
      try {
        child.kill("SIGTERM");
      } catch {
        return;
      }
      const stopDeadline = Date.now() + 2000;
      while (Date.now() < stopDeadline) {
        if (!isLiveChild()) {
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      if (isLiveChild()) {
        try {
          child.kill("SIGKILL");
        } catch {
          // Ignore if already exited
        }
      }
    };

    let startupResult: StartupResult;
    let timedOut = false;
    try {
      startupResult = await new Promise<StartupResult>((resolve, reject) => {
        let settled = false;
        const done = (err?: Error, result?: StartupResult) => {
          if (settled) {
            return;
          }
          settled = true;
          clearInterval(pollTimer);
          clearTimeout(timeoutTimer);
          child.removeListener("error", onError);
          child.removeListener("exit", onExit);
          if (err) {
            reject(err);
          } else if (result) {
            resolve(result);
          }
        };

        const checkReadyMarker = () => {
          if (settled || !fs.existsSync(readyFile)) {
            return;
          }
          try {
            const raw = fs.readFileSync(readyFile, "utf-8").trim();
            if (raw === "already_running") {
              done(undefined, { outcome: "already_running" });
              return;
            }
            const readyPrefix = raw.startsWith("ready:") ? raw.slice(6) : raw;
            const markerPid = parseInt(readyPrefix, 10);
            if (
              Number.isInteger(markerPid) &&
              markerPid > 0 &&
              (markerPid === child.pid || isPidRunning(markerPid))
            ) {
              done(undefined, { outcome: "started", pid: markerPid });
            }
          } catch {
            // Marker may still be flushing; retry next poll
          }
        };

        const onError = (err: Error) => {
          done(new Error(`Failed to start tray app: ${err.message}`));
        };

        const onExit = (code: number | null, sig: NodeJS.Signals | null) => {
          // Check whether tray_app.py wrote an explicit already_running/ready marker before exiting
          checkReadyMarker();
          if (settled) {
            return;
          }
          done(
            new Error(
              `Tray app exited before signaling readiness (code=${code ?? "null"}, signal=${sig ?? "null"})`
            )
          );
        };

        const pollTimer = setInterval(checkReadyMarker, 100);

        const timeoutTimer = setTimeout(() => {
          checkReadyMarker();
          if (settled) {
            return;
          }
          timedOut = true;
          done(
            new Error(
              `Timed out after ${startupTimeoutMs / 1000}s waiting for Local Voice MCP tray to initialize.`
            )
          );
        }, startupTimeoutMs);

        child.on("error", onError);
        child.on("exit", onExit);
      });
    } catch (err) {
      if (timedOut) {
        await terminateHungChild();
      }
      throw err;
    } finally {
      try {
        fs.rmSync(readyDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }

    if (startupResult.outcome === "already_running") {
      const running = getRunningTrayInfo();
      console.log(
        running
          ? `Local Voice MCP tray is already running (PID ${running.pid}).`
          : "Local Voice MCP tray is already running."
      );
      return;
    }

    child.unref();
    console.log(
      `Started Local Voice MCP tray in background (PID ${startupResult.pid}).`
    );
    return;
  }

  const pyArgs = [scriptPath, ...(force ? ["--force"] : [])];
  const child = spawn(pythonPath, pyArgs, { stdio: "inherit" });
  child.on("close", (code, signal) => {
    if (signal) {
      process.exit(1);
    }
    process.exit(code ?? 1);
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
