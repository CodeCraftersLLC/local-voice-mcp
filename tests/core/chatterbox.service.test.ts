// Mock child_process to avoid actual Python execution in tests
jest.mock("child_process", () => ({
  spawn: jest.fn(),
  exec: jest.fn(),
}));

import { ChatterboxService } from "../../src/core/chatterbox.service";
import fs from "fs";
import path from "path";
import os from "os";

// Mock fs operations
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  statSync: jest.fn(),
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

    it("should provide access to bundled reference audio path", () => {
      chatterboxService = new ChatterboxService();
      const bundledPath = chatterboxService.getBundledReferenceAudioPath();
      expect(bundledPath).toContain("female-reference-voice.wav");
      expect(path.isAbsolute(bundledPath)).toBe(true);
    });
  });

  describe("ensureReady", () => {
    it("should return a promise that resolves when environment is ready", async () => {
      chatterboxService = new ChatterboxService();

      // Mock successful environment setup
      await expect(chatterboxService.ensureReady()).resolves.toBeUndefined();
    });

    describe("security validators", () => {
      it("should reject arguments containing slashes in sanitizeArg", () => {
        const service = new ChatterboxService();

        expect(() => service.sanitizeArg("valid/arg", false)).toThrow(
          "Argument cannot contain slashes"
        );
        expect(() => service.sanitizeArg("invalid\\arg", false)).toThrow(
          "Argument cannot contain slashes"
        );
        expect(() => service.sanitizeArg("valid-arg", false)).not.toThrow();
      });

      it("should allow common punctuation in sanitizeArg", () => {
        const service = new ChatterboxService();

        // Test common punctuation marks that should be allowed for TTS
        expect(() => service.sanitizeArg("Hello, world!", false)).not.toThrow();
        expect(() =>
          service.sanitizeArg("What's happening?", false)
        ).not.toThrow();
        expect(() =>
          service.sanitizeArg("Great! How are you?", false)
        ).not.toThrow();
        expect(() =>
          service.sanitizeArg("Text with (parentheses) and [brackets]", false)
        ).not.toThrow(); // Parentheses and brackets are allowed in the current implementation
        expect(() =>
          service.sanitizeArg("Email@example.com", false)
        ).not.toThrow();
        expect(() => service.sanitizeArg("Price: $10.99", false)).not.toThrow(); // $ character is allowed
        expect(() => service.sanitizeArg("Math: 2+2=4", false)).not.toThrow();

        // Test that the result is returned correctly
        expect(service.sanitizeArg("Hello, world!", false)).toBe(
          "Hello, world!"
        );
        expect(service.sanitizeArg("What's happening?", false)).toBe(
          "What's happening?"
        );
      });

      it("should validate reference audio paths from anywhere in the system", () => {
        const service = new ChatterboxService();

        // Create a test audio file in the user's home directory (simulating user's audio collection)
        const homeDir = os.homedir();
        const testAudioPath = path.join(homeDir, "test-reference.wav");

        // Mock file system to simulate the file exists
        mockFs.existsSync.mockImplementation((filePath: any) => {
          const pathStr = filePath.toString();
          return (
            pathStr === testAudioPath ||
            pathStr.includes("local-voice-mcp") ||
            pathStr.includes("test-reference.wav")
          );
        });
        mockFs.statSync.mockImplementation((filePath: any) => {
          const pathStr = filePath.toString();
          if (
            pathStr === testAudioPath ||
            pathStr.includes("test-reference.wav")
          ) {
            return { isFile: () => true } as any;
          }
          return { isFile: () => false } as any;
        });

        // Should allow access to user's audio files anywhere in the system
        expect(() =>
          service.validateReferenceAudioPath(testAudioPath)
        ).not.toThrow();

        // Should resolve to absolute path
        const result = service.validateReferenceAudioPath(testAudioPath);
        expect(result).toBe(testAudioPath);

        // Should handle relative paths
        expect(() =>
          service.validateReferenceAudioPath("./test-reference.wav")
        ).not.toThrow();

        // Should reject non-existent files
        expect(() =>
          service.validateReferenceAudioPath("/nonexistent/file.wav")
        ).toThrow("Reference audio file not found");

        // Should reject unsupported formats
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isFile: () => true } as any);
        expect(() =>
          service.validateReferenceAudioPath("/home/user/document.txt")
        ).toThrow("Unsupported reference audio format");
      });

      it("should validate audio paths correctly", () => {
        const service = new ChatterboxService();
        const serviceAny = service as any; // Type assertion to access private methods
        const testPath = path.join(os.tmpdir(), "test-audio.wav");
        const tempDir = os.tmpdir();
        const invalidFile = path.join(os.tmpdir(), "invalid.txt");

        // Mock file system for this test
        mockFs.existsSync.mockImplementation((filePath: any) => {
          const pathStr = filePath.toString();
          return pathStr === testPath || pathStr.includes("local-voice-mcp");
        });
        mockFs.statSync.mockImplementation((filePath: any) => {
          const pathStr = filePath.toString();
          if (pathStr === testPath) {
            return { isFile: () => true } as any;
          }
          return { isFile: () => false } as any;
        });

        // Test valid path
        expect(service.validateAudioPath(testPath)).toBe(testPath);

        // Test path traversal - the current implementation resolves the path first,
        // so ../../etc/passwd becomes /etc/passwd and fails the temp directory check
        expect(() => service.validateAudioPath("../../etc/passwd")).toThrow(
          "Access restricted to temporary directory only"
        );

        // Test access outside temp directory
        expect(() => serviceAny.validateAudioPath("/etc/passwd")).toThrow(
          "Access restricted to temporary directory only"
        );

        // Test non-existent file
        expect(() => serviceAny.validateAudioPath("non-existent.wav")).toThrow(
          "Access restricted to temporary directory only"
        );

        // Test directory instead of file
        mockFs.existsSync.mockImplementation((filePath: any) => {
          const pathStr = filePath.toString();
          return (
            pathStr === invalidFile ||
            pathStr === testPath ||
            pathStr === tempDir ||
            pathStr.includes("local-voice-mcp")
          );
        });
        mockFs.statSync.mockImplementation((filePath: any) => {
          const pathStr = filePath.toString();
          if (pathStr === invalidFile || pathStr === testPath) {
            return { isFile: () => true } as any;
          }
          if (pathStr === tempDir) {
            return { isFile: () => false } as any; // Directory, not a file
          }
          return { isFile: () => false } as any;
        });
        expect(() => service.validateAudioPath(tempDir)).toThrow(
          "Path is not a file"
        );

        // Test invalid extension
        mockFs.existsSync.mockImplementation((filePath: any) => {
          const pathStr = filePath.toString();
          return (
            pathStr === invalidFile ||
            pathStr === testPath ||
            pathStr.includes("local-voice-mcp")
          );
        });
        mockFs.statSync.mockImplementation((filePath: any) => {
          const pathStr = filePath.toString();
          if (pathStr === invalidFile || pathStr === testPath) {
            return { isFile: () => true } as any;
          }
          return { isFile: () => false } as any;
        });
        expect(() => serviceAny.validateAudioPath(invalidFile)).toThrow(
          "Unsupported audio format"
        );
      });

      it("should block malicious paths in reference audio", async () => {
        // Mock a complete process with all event handlers
        const mockProcess = {
          stderr: {
            on: jest.fn().mockReturnThis(),
          },
          stdout: {
            on: jest.fn().mockReturnThis(),
          },
          on: jest.fn((event, callback) => {
            if (event === "close") {
              setTimeout(() => callback(0), 10);
            }
          }),
        };
        mockSpawn.mockReturnValue(mockProcess);

        const service = new ChatterboxService();
        const bundledPath = service.getBundledReferenceAudioPath();

        mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
          const pathStr = p.toString();
          return pathStr.includes("malicious")
            ? false
            : pathStr === bundledPath || pathStr.includes("local-voice-mcp");
        });

        // Should not throw but should log warning and fallback to bundled reference audio
        await service.synthesize("Test", {
          referenceAudio: "../../etc/passwd",
        });

        const args = mockSpawn.mock.calls[0][1];
        const refAudioIndex = args.indexOf("--reference_audio") + 1;
        expect(args[refAudioIndex]).toBe(bundledPath);
      });
    });
  });

  describe("synthesize", () => {
    beforeEach(() => {
      chatterboxService = new ChatterboxService();
      // Clean up environment variables before each test
      delete process.env.CHATTERBOX_REFERENCE_AUDIO;
      delete process.env.CHATTERBOX_EXAGGERATION;
      delete process.env.CHATTERBOX_CFG_WEIGHT;
      delete process.env.CHATTERBOX_MAX_CHARACTERS;
      delete process.env.USE_MALE_VOICE;
    });

    afterEach(() => {
      // Clean up environment variables after each test
      delete process.env.CHATTERBOX_REFERENCE_AUDIO;
      delete process.env.CHATTERBOX_EXAGGERATION;
      delete process.env.CHATTERBOX_CFG_WEIGHT;
      delete process.env.CHATTERBOX_MAX_CHARACTERS;
      delete process.env.USE_MALE_VOICE;
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
        stdout: { on: jest.fn() },
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
        stdout: { on: jest.fn() },
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
        stdout: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
        }),
      };
      mockProcess.stderr.on.mockImplementation(() => mockProcess);
      mockProcess.stdout.on.mockImplementation(() => mockProcess);

      mockSpawn.mockReturnValue(mockProcess);

      const bundledPath = chatterboxService.getBundledReferenceAudioPath();
      mockFs.existsSync.mockImplementation((filePath: any) => {
        const pathStr = filePath.toString();
        return pathStr.includes("local-voice-mcp") || pathStr === bundledPath;
      });

      await chatterboxService.synthesize("Test text", {
        referenceAudio: "test.wav",
        exaggeration: 0.5,
        cfg_weight: 1.5,
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          "--text",
          "Test text",
          "--reference_audio",
          bundledPath,
          "--exaggeration",
          "0.5",
          "--cfg_weight",
          "1.5",
        ])
      );
    });

    it("should reject empty text input", async () => {
      await expect(chatterboxService.synthesize("", {})).rejects.toThrow();
    });

    it("should reject text that exceeds default character limit", async () => {
      const longText = "a".repeat(2001); // Exceeds default limit of 2000
      await expect(chatterboxService.synthesize(longText, {})).rejects.toThrow(
        "Text exceeds maximum character limit of 2000 characters. Current length: 2001"
      );
    });

    it("should accept text within default character limit", async () => {
      const validText = "a".repeat(2000); // Exactly at default limit of 2000

      const mockProcess = {
        stderr: { on: jest.fn() },
        stdout: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
        }),
      };

      mockSpawn.mockReturnValue(mockProcess);
      mockFs.existsSync.mockReturnValue(true);

      const result = await chatterboxService.synthesize(validText, {});
      expect(result).toContain("tts-");
      expect(result).toContain(".wav");
    });

    it("should respect custom character limit from environment variable", async () => {
      process.env.CHATTERBOX_MAX_CHARACTERS = "100";

      const longText = "a".repeat(101); // Exceeds custom limit of 100
      await expect(chatterboxService.synthesize(longText, {})).rejects.toThrow(
        "Text exceeds maximum character limit of 100 characters. Current length: 101"
      );
    });

    it("should accept text within custom character limit", async () => {
      process.env.CHATTERBOX_MAX_CHARACTERS = "100";
      const validText = "a".repeat(100); // Exactly at custom limit of 100

      const mockProcess = {
        stderr: { on: jest.fn() },
        stdout: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
        }),
      };

      mockSpawn.mockReturnValue(mockProcess);
      mockFs.existsSync.mockReturnValue(true);

      const result = await chatterboxService.synthesize(validText, {});
      expect(result).toContain("tts-");
      expect(result).toContain(".wav");
    });

    it("should use environment variables as defaults", async () => {
      // Set environment variables
      process.env.CHATTERBOX_REFERENCE_AUDIO = "env-reference.wav";
      process.env.CHATTERBOX_EXAGGERATION = "0.8";
      process.env.CHATTERBOX_CFG_WEIGHT = "2.0";

      const mockProcess = {
        stderr: { on: jest.fn() },
        stdout: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
        }),
      };

      mockSpawn.mockReturnValue(mockProcess);

      const bundledPath = chatterboxService.getBundledReferenceAudioPath();
      mockFs.existsSync.mockImplementation((filePath: any) => {
        const pathStr = filePath.toString();
        return pathStr.includes("local-voice-mcp") || pathStr === bundledPath;
      });

      await chatterboxService.synthesize("Test text", {});

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          "--text",
          "Test text",
          "--reference_audio",
          bundledPath,
          "--exaggeration",
          "0.8",
          "--cfg_weight",
          "2",
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
        stdout: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
        }),
      };

      mockSpawn.mockReturnValue(mockProcess);

      const bundledPath = chatterboxService.getBundledReferenceAudioPath();
      mockFs.existsSync.mockImplementation((filePath: any) => {
        const pathStr = filePath.toString();
        return pathStr.includes("local-voice-mcp") || pathStr === bundledPath;
      });

      await chatterboxService.synthesize("Test text", {
        referenceAudio: "option-reference.wav",
        exaggeration: 0.3,
        cfg_weight: 1.2,
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          "--text",
          "Test text",
          "--reference_audio",
          bundledPath,
          "--exaggeration",
          "0.3",
          "--cfg_weight",
          "1.2",
        ])
      );
    });

    it("should use bundled reference audio when no reference audio is specified", async () => {
      const mockProcess = {
        stderr: { on: jest.fn() },
        stdout: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
        }),
      };

      mockSpawn.mockReturnValue(mockProcess);

      // Mock that the bundled reference audio exists
      const bundledPath = chatterboxService.getBundledReferenceAudioPath();
      mockFs.existsSync.mockImplementation((filePath: any) => {
        const pathStr = filePath.toString();
        return pathStr.includes("local-voice-mcp") || pathStr === bundledPath;
      });

      await chatterboxService.synthesize("Test text", {});

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          "--text",
          "Test text",
          "--reference_audio",
          bundledPath,
        ])
      );
    });

    it("should fallback to bundled reference audio when specified reference audio fails validation", async () => {
      const mockProcess = {
        stderr: { on: jest.fn() },
        stdout: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
        }),
      };

      mockSpawn.mockReturnValue(mockProcess);

      // Mock that the bundled reference audio exists but the specified one doesn't
      const bundledPath = chatterboxService.getBundledReferenceAudioPath();
      mockFs.existsSync.mockImplementation((filePath: any) => {
        const pathStr = filePath.toString();
        return pathStr.includes("local-voice-mcp") || pathStr === bundledPath;
      });

      await chatterboxService.synthesize("Test text", {
        referenceAudio: "nonexistent.wav",
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          "--text",
          "Test text",
          "--reference_audio",
          bundledPath,
        ])
      );
    });

    it("should use default male voice when USE_MALE_VOICE is true", async () => {
      process.env.USE_MALE_VOICE = "true";

      const mockProcess = {
        stderr: { on: jest.fn() },
        stdout: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
        }),
      };

      mockSpawn.mockReturnValue(mockProcess);

      const bundledPath = chatterboxService.getBundledReferenceAudioPath();
      mockFs.existsSync.mockImplementation((filePath: any) => {
        const pathStr = filePath.toString();
        return pathStr.includes("local-voice-mcp") || pathStr === bundledPath;
      });

      await chatterboxService.synthesize("Test text", {});

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          "--text",
          "Test text",
          "--reference_audio",
          "", // Should be empty when using male voice
        ])
      );
    });

    it("should use bundled female voice when USE_MALE_VOICE is false", async () => {
      process.env.USE_MALE_VOICE = "false";

      const mockProcess = {
        stderr: { on: jest.fn() },
        stdout: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
        }),
      };

      mockSpawn.mockReturnValue(mockProcess);

      const bundledPath = chatterboxService.getBundledReferenceAudioPath();
      mockFs.existsSync.mockImplementation((filePath: any) => {
        const pathStr = filePath.toString();
        return pathStr.includes("local-voice-mcp") || pathStr === bundledPath;
      });

      await chatterboxService.synthesize("Test text", {});

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          "--text",
          "Test text",
          "--reference_audio",
          bundledPath, // Should use bundled female voice
        ])
      );
    });

    it("should prioritize custom reference audio over USE_MALE_VOICE setting", async () => {
      process.env.USE_MALE_VOICE = "true";

      const mockProcess = {
        stderr: { on: jest.fn() },
        stdout: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
        }),
      };

      mockSpawn.mockReturnValue(mockProcess);

      const customAudioPath = "/Users/test/custom-voice.wav";
      mockFs.existsSync.mockImplementation((filePath: any) => {
        const pathStr = filePath.toString();
        return (
          pathStr.includes("local-voice-mcp") || pathStr === customAudioPath
        );
      });
      mockFs.statSync.mockImplementation((filePath: any) => {
        const pathStr = filePath.toString();
        if (pathStr === customAudioPath) {
          return { isFile: () => true } as any;
        }
        return { isFile: () => false } as any;
      });

      await chatterboxService.synthesize("Test text", {
        referenceAudio: customAudioPath,
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          "--text",
          "Test text",
          "--reference_audio",
          customAudioPath, // Should use custom audio even when USE_MALE_VOICE is true
        ])
      );
    });
  });
});
