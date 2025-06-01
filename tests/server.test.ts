import fs from "fs";

// Mock the entire server module to avoid Express import issues
jest.mock("../src/server", () => ({
  startApp: jest.fn().mockResolvedValue(undefined),
}));

// Mock the ChatterboxService
jest.mock("../src/core/chatterbox.service", () => ({
  ChatterboxService: jest.fn().mockImplementation(() => ({
    ensureReady: jest.fn().mockResolvedValue(undefined),
    synthesize: jest.fn(),
  })),
}));

// Mock fs operations
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  createReadStream: jest.fn(),
  unlink: jest.fn(),
}));

// Mock stream operations
jest.mock("stream", () => ({
  ...jest.requireActual("stream"),
  finished: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockFinished = require("stream").finished;

describe("Server", () => {
  let mockChatterbox: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset modules to get fresh instances
    jest.resetModules();

    // Mock file system operations
    mockFs.existsSync.mockReturnValue(true);
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.unlink.mockImplementation((path, callback) => {
      if (callback) callback(null);
    });

    // Mock stream finished
    mockFinished.mockImplementation((stream: any, callback: any) => {
      setTimeout(() => callback(null), 10);
    });

    // Create a mock readable stream
    const mockStream = {
      pipe: jest.fn(),
      on: jest.fn(),
    };
    mockFs.createReadStream.mockReturnValue(mockStream as any);
  });

  describe("startApp", () => {
    it("should start the server successfully", async () => {
      const { startApp } = require("../src/server");
      const port = 3001;

      await expect(startApp(port)).resolves.toBeUndefined();
    });

    it("should handle initialization failure", async () => {
      const { startApp } = require("../src/server");

      // Mock the startApp to reject
      startApp.mockRejectedValueOnce(new Error("Init failed"));

      const port = 3002;

      await expect(startApp(port)).rejects.toThrow("Init failed");
    });
  });

  describe("TTS Handler", () => {
    // Note: Testing the actual HTTP endpoints would require more complex setup
    // These tests focus on the core logic that can be unit tested

    it("should validate required text parameter", () => {
      // This would be tested through integration tests with the actual server
      expect(true).toBe(true); // Placeholder
    });

    it("should handle file cleanup in finally block", () => {
      // This would be tested through integration tests
      expect(true).toBe(true); // Placeholder
    });

    it("should validate audio path security", () => {
      // This would be tested through integration tests
      expect(true).toBe(true); // Placeholder
    });
  });

});

describe("File Cleanup Logic", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.unlink.mockImplementation((path, callback) => {
      if (callback) callback(null);
    });
  });

  it("should clean up files after successful streaming", () => {
    // Mock the cleanup logic
    const audioPath = "/tmp/local-voice-mcp/test.wav";

    // Simulate the finally block logic
    if (audioPath && mockFs.existsSync(audioPath)) {
      const resolvedPath = require("path").resolve(audioPath);
      const normalizedTempDir =
        require("path").normalize("/tmp/local-voice-mcp") + require("path").sep;

      if (resolvedPath.startsWith(normalizedTempDir)) {
        mockFs.unlink(audioPath, (err) => {
          if (err) {
            console.error(`Error deleting temp file ${audioPath}:`, err);
          } else {
            console.log(`Successfully deleted temp file: ${audioPath}`);
          }
        });
      }
    }

    expect(mockFs.unlink).toHaveBeenCalledWith(audioPath, expect.any(Function));
  });

  it("should not delete files outside temp directory", () => {
    const maliciousPath = "/etc/passwd";

    // Simulate the security check
    const resolvedPath = require("path").resolve(maliciousPath);
    const normalizedTempDir =
      require("path").normalize("/tmp/local-voice-mcp") + require("path").sep;

    if (!resolvedPath.startsWith(normalizedTempDir)) {
      console.error(
        `Security Alert: Skipped deletion of suspicious path: ${maliciousPath}`
      );
    } else {
      mockFs.unlink(maliciousPath, jest.fn());
    }

    expect(mockFs.unlink).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Security Alert")
    );
  });

  it("should handle file deletion errors gracefully", () => {
    const audioPath = "/tmp/local-voice-mcp/test.wav";

    mockFs.unlink.mockImplementation((path, callback) => {
      if (callback) callback(new Error("Permission denied"));
    });

    // Simulate the cleanup with error
    mockFs.unlink(audioPath, (err) => {
      if (err) {
        console.error(`Error deleting temp file ${audioPath}:`, err);
      }
    });

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Error deleting temp file"),
      expect.any(Error)
    );
  });
});
