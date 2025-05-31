import { ChatterboxService } from "../../src/core/chatterbox.service";
import fs from "fs";
import path from "path";
import os from "os";

// Mock child_process to avoid actual Python execution in tests
jest.mock("child_process", () => ({
  spawn: jest.fn(),
  exec: jest.fn(),
}));

// Mock fs operations
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockSpawn = require("child_process").spawn;
const mockExec = require("child_process").exec;

describe("ChatterboxService", () => {
  let chatterboxService: ChatterboxService;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock successful environment setup
    mockExec.mockImplementation((cmd: string, callback?: Function) => {
      if (callback) {
        callback(null, { stdout: "success", stderr: "" });
      }
      return Promise.resolve({ stdout: "success", stderr: "" });
    });

    // Mock file system operations
    mockFs.existsSync.mockReturnValue(true);
    mockFs.mkdirSync.mockReturnValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with correct paths", () => {
      chatterboxService = new ChatterboxService();
      expect(chatterboxService).toBeInstanceOf(ChatterboxService);
    });
  });

  describe("ensureReady", () => {
    it("should return a promise that resolves when environment is ready", async () => {
      chatterboxService = new ChatterboxService();

      // Mock successful environment setup
      await expect(chatterboxService.ensureReady()).resolves.toBeUndefined();
    });

    it("should handle environment setup failure", async () => {
      // Mock failed environment setup
      mockExec.mockImplementation(() => {
        throw new Error("Environment setup failed");
      });

      chatterboxService = new ChatterboxService();

      await expect(chatterboxService.ensureReady()).rejects.toThrow();
    });
  });

  describe("synthesize", () => {
    beforeEach(() => {
      chatterboxService = new ChatterboxService();
      // Clean up environment variables before each test
      delete process.env.CHATTERBOX_REFERENCE_AUDIO;
      delete process.env.CHATTERBOX_EXAGGERATION;
      delete process.env.CHATTERBOX_CFG_WEIGHT;
    });

    afterEach(() => {
      // Clean up environment variables after each test
      delete process.env.CHATTERBOX_REFERENCE_AUDIO;
      delete process.env.CHATTERBOX_EXAGGERATION;
      delete process.env.CHATTERBOX_CFG_WEIGHT;
    });

    it("should synthesize text successfully", async () => {
      const mockOutputFile = path.join(
        os.tmpdir(),
        "local-voice-mcp",
        "test-output.wav"
      );

      // Mock successful Python process
      const mockProcess = {
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === "close") {
            // Simulate successful completion
            setTimeout(() => callback(0), 10);
          }
        }),
      };

      mockSpawn.mockReturnValue(mockProcess);
      mockFs.existsSync.mockReturnValue(true);

      const result = await chatterboxService.synthesize("Hello world", {});

      expect(result).toContain("tts-");
      expect(result).toContain(".wav");
      expect(mockSpawn).toHaveBeenCalled();
    });

    it("should handle synthesis failure", async () => {
      // Mock failed Python process
      const mockProcess = {
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === "close") {
            // Simulate failure
            setTimeout(() => callback(1), 10);
          }
        }),
      };

      mockSpawn.mockReturnValue(mockProcess);
      mockFs.existsSync.mockReturnValue(false);

      await expect(
        chatterboxService.synthesize("Hello world", {})
      ).rejects.toThrow("TTS synthesis failed");
    });

    it("should validate and sanitize input parameters", async () => {
      const mockProcess = {
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
        }),
      };

      mockSpawn.mockReturnValue(mockProcess);
      mockFs.existsSync.mockReturnValue(true);

      await chatterboxService.synthesize("Test text", {
        referenceAudio: "test.wav",
        exaggeration: 0.5,
        cfg_weight: 1.5,
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          expect.stringContaining("--text=Test text"),
          expect.stringContaining("--reference_audio="),
          expect.stringContaining("--exaggeration=0.5"),
          expect.stringContaining("--cfg_weight=1.5"),
        ])
      );
    });

    it("should reject empty text input", async () => {
      await expect(chatterboxService.synthesize("", {})).rejects.toThrow();
    });

    it("should use environment variables as defaults", async () => {
      // Set environment variables
      process.env.CHATTERBOX_REFERENCE_AUDIO = "env-reference.wav";
      process.env.CHATTERBOX_EXAGGERATION = "0.8";
      process.env.CHATTERBOX_CFG_WEIGHT = "2.0";

      const mockProcess = {
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
        }),
      };

      mockSpawn.mockReturnValue(mockProcess);
      mockFs.existsSync.mockReturnValue(true);

      await chatterboxService.synthesize("Test text", {});

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          expect.stringContaining("--text=Test text"),
          expect.stringContaining("--reference_audio="),
          expect.stringContaining("--exaggeration=0.8"),
          expect.stringContaining("--cfg_weight=2"),
        ])
      );
    });

    it("should prioritize options over environment variables", async () => {
      // Set environment variables
      process.env.CHATTERBOX_REFERENCE_AUDIO = "env-reference.wav";
      process.env.CHATTERBOX_EXAGGERATION = "0.8";
      process.env.CHATTERBOX_CFG_WEIGHT = "2.0";

      const mockProcess = {
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
        }),
      };

      mockSpawn.mockReturnValue(mockProcess);
      mockFs.existsSync.mockReturnValue(true);

      await chatterboxService.synthesize("Test text", {
        referenceAudio: "option-reference.wav",
        exaggeration: 0.3,
        cfg_weight: 1.2,
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          expect.stringContaining("--text=Test text"),
          expect.stringContaining("--reference_audio="),
          expect.stringContaining("--exaggeration=0.3"),
          expect.stringContaining("--cfg_weight=1.2"),
        ])
      );
    });
  });
});
