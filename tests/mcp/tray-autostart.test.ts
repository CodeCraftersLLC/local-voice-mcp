import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import * as childProcess from "child_process";

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
}));
jest.mock("child_process", () => ({
  ...jest.requireActual("child_process"),
  spawn: jest.fn(),
}));
jest.mock("get-port", () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(59125),
}));
jest.mock("../../src/mcp/mcp-server", () => ({
  createMCPServer: jest.fn(),
}));
jest.mock("../../src/server", () => ({
  startApp: jest.fn(),
}));

import { maybeStartTrayHelper } from "../../src/mcp-server";
import { logger } from "../../src/utils/logger";

describe("maybeStartTrayHelper", () => {
  const originalEnableTray = process.env.ENABLE_TRAY;
  const mockSpawn = childProcess.spawn as jest.Mock;
  const mockExistsSync = fs.existsSync as jest.Mock;
  let warnSpy: jest.SpyInstance;
  let infoSpy: jest.SpyInstance;

  function makeFakeChild() {
    const emitter = new EventEmitter() as any;
    emitter.unref = jest.fn();
    return emitter;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
    infoSpy = jest.spyOn(logger, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    infoSpy.mockRestore();
    if (originalEnableTray !== undefined) {
      process.env.ENABLE_TRAY = originalEnableTray;
    } else {
      delete process.env.ENABLE_TRAY;
    }
  });

  it("does nothing when ENABLE_TRAY is unset or false", () => {
    delete process.env.ENABLE_TRAY;
    maybeStartTrayHelper();
    expect(mockSpawn).not.toHaveBeenCalled();

    process.env.ENABLE_TRAY = "false";
    maybeStartTrayHelper();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("spawns sibling tray-cli.js when present", () => {
    process.env.ENABLE_TRAY = "true";
    const fakeChild = makeFakeChild();
    mockSpawn.mockReturnValue(fakeChild);
    mockExistsSync.mockImplementation((p: fs.PathLike) =>
      String(p).endsWith(path.join("src", "tray-cli.js"))
    );

    maybeStartTrayHelper();

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [execPath, args, opts] = mockSpawn.mock.calls[0];
    expect(execPath).toBe(process.execPath);
    expect(args[0]).toMatch(/tray-cli\.js$/);
    expect(args[1]).toBe("--background");
    expect(opts).toEqual({ detached: true, stdio: "ignore" });
    expect(fakeChild.unref).toHaveBeenCalled();
  });

  it("falls back to ../dist/tray-cli.js when sibling tray-cli.js is absent", () => {
    process.env.ENABLE_TRAY = "true";
    const fakeChild = makeFakeChild();
    mockSpawn.mockReturnValue(fakeChild);
    mockExistsSync.mockImplementation((p: fs.PathLike) =>
      String(p).endsWith(path.join("dist", "tray-cli.js"))
    );

    maybeStartTrayHelper();

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [, args] = mockSpawn.mock.calls[0];
    expect(args[0]).toMatch(/dist[\\/]+tray-cli\.js$/);
    expect(args[1]).toBe("--background");
  });

  it("falls back to ts-node/register resolved from repo when only tray-cli.ts exists", () => {
    process.env.ENABLE_TRAY = "true";
    const fakeChild = makeFakeChild();
    mockSpawn.mockReturnValue(fakeChild);
    mockExistsSync.mockImplementation((p: fs.PathLike) =>
      String(p).endsWith(path.join("src", "tray-cli.ts"))
    );

    maybeStartTrayHelper();

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [, args] = mockSpawn.mock.calls[0];
    expect(args[0]).toBe("-r");
    expect(path.isAbsolute(args[1])).toBe(true);
    expect(args[1]).toMatch(/ts-node/);
    expect(args[2]).toMatch(/tray-cli\.ts$/);
    expect(args[3]).toBe("--background");
  });

  it("warns without spawning when no tray entrypoint exists", () => {
    process.env.ENABLE_TRAY = "true";
    mockExistsSync.mockReturnValue(false);

    maybeStartTrayHelper();

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Tray helper entrypoint not found")
    );
  });

  it("logs warnings on child error, non-zero exit, and signal termination", () => {
    process.env.ENABLE_TRAY = "true";
    const fakeChild = makeFakeChild();
    mockSpawn.mockReturnValue(fakeChild);
    mockExistsSync.mockReturnValue(true);

    maybeStartTrayHelper();
    fakeChild.emit("error", new Error("ENOENT"));
    fakeChild.emit("exit", 1, null);
    fakeChild.emit("exit", null, "SIGTERM");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to launch tray helper: ENOENT")
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Tray helper exited with code 1")
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Tray helper terminated by signal SIGTERM")
    );
  });
});
