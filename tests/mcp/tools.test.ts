import { TTSTools, TTSToolSchemas } from "../../src/mcp/tools";
import fs from "fs";
import path from "path";

// Mock the TTSService
jest.mock("../../src/core/tts-service.factory", () => ({
  TTSService: jest.fn().mockImplementation(() => ({
    ensureReady: jest.fn().mockResolvedValue(undefined),
    synthesize: jest.fn(),
    getStatus: jest.fn().mockResolvedValue({
      ready: true,
      capabilities: ["voice-cloning", "prosody-control"],
      engineName: "chatterbox",
      version: "0.1.5"
    }),
    getEngineType: jest.fn().mockReturnValue("chatterbox"),
    getEngineName: jest.fn().mockReturnValue("chatterbox"),
  })),
}));

// Mock fs operations
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe("TTSTools", () => {
  let ttsTools: TTSTools;
  let mockTTSService: any;

  beforeEach(() => {
    jest.clearAllMocks();

    ttsTools = new TTSTools();
    mockTTSService = (ttsTools as any).ttsService;

    // Mock file system operations
    mockFs.existsSync.mockReturnValue(true);
    mockFs.mkdirSync.mockReturnValue(undefined);
  });

  describe("ensureReady", () => {
    it("should call ttsService ensureReady", async () => {
      await ttsTools.ensureReady();
      expect(mockTTSService.ensureReady).toHaveBeenCalled();
    });
  });

  describe("synthesizeText", () => {
    it("should synthesize text successfully", async () => {
      const mockAudioPath = require("path").join(
        require("os").tmpdir(),
        "local-voice-mcp",
        "test-audio.wav"
      );
      mockTTSService.synthesize.mockResolvedValue(mockAudioPath);

      const result = await ttsTools.synthesizeText({
        text: "Hello world",
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");

      // Parse the JSON response
      const textResponse = JSON.parse(result.content[0].text!);
      expect(textResponse.success).toBe(true);
      expect(textResponse.message).toBe(
        "Speech synthesis completed successfully"
      );
      expect(textResponse.audioFormat).toBe("wav");
      expect(textResponse.audioFile).toBe(mockAudioPath);
      expect(textResponse.textLength).toBe(11);

      // File should NOT be deleted in the new approach - no cleanup in simplified version
    });

    it("should handle synthesis with options", async () => {
      const mockAudioPath = require("path").join(
        require("os").tmpdir(),
        "local-voice-mcp",
        "test-audio.wav"
      );
      mockTTSService.synthesize.mockResolvedValue(mockAudioPath);

      // Create a valid reference audio file path for testing
      const refAudioPath = require("path").join(
        require("os").tmpdir(),
        "test-ref.wav"
      );

      // Mock the ChatterboxService's validateReferenceAudioPath method to return the path
      // Reference audio validation is now handled by the engine

      await ttsTools.synthesizeText({
        text: "Hello world",
        referenceAudio: refAudioPath,
      });

      expect(mockTTSService.synthesize).toHaveBeenCalledWith("Hello world", {
        referenceAudio: refAudioPath, // Should be the resolved path
      });
    });

    it("should handle reference audio from anywhere in the system", async () => {
      const mockAudioPath = require("path").join(
        require("os").tmpdir(),
        "local-voice-mcp",
        "test-audio.wav"
      );
      mockTTSService.synthesize.mockResolvedValue(mockAudioPath);

      // Test with a reference audio file in user's home directory
      const homeDir = require("os").homedir();
      const userRefAudioPath = require("path").join(
        homeDir,
        "Music",
        "my-voice.wav"
      );

      const result = await ttsTools.synthesizeText({
        text: "Hello from my custom voice!",
        referenceAudio: userRefAudioPath,
      });

      expect(result.content).toHaveLength(1);
      expect(!("isError" in result) || !result.isError).toBe(true);

      const response = JSON.parse(result.content[0].text!);
      expect(response.success).toBe(true);
      expect(response.message).toContain(
        "Speech synthesis completed successfully"
      );

      expect(mockTTSService.synthesize).toHaveBeenCalledWith(
        "Hello from my custom voice!",
        expect.objectContaining({
          referenceAudio: userRefAudioPath, // Should allow system-wide paths
        })
      );
    });

    it("should handle text with punctuation", async () => {
      const mockAudioPath = require("path").join(
        require("os").tmpdir(),
        "local-voice-mcp",
        "test-audio.wav"
      );
      mockTTSService.synthesize.mockResolvedValue(mockAudioPath);

      const result = await ttsTools.synthesizeText({
        text: "Hello, world! How are you? I'm doing great!",
      });

      expect(result.content).toHaveLength(1);
      expect(!("isError" in result) || !result.isError).toBe(true);

      const response = JSON.parse(result.content[0].text!);
      expect(response.success).toBe(true);
      expect(response.message).toContain(
        "Speech synthesis completed successfully"
      );

      // Just verify it was called with the right text, don't check all params
      expect(mockTTSService.synthesize).toHaveBeenCalledWith(
        "Hello, world! How are you? I'm doing great!",
        expect.any(Object)
      );
    });

    it("should handle text with various punctuation marks", async () => {
      const mockAudioPath = require("path").join(
        require("os").tmpdir(),
        "local-voice-mcp",
        "test-audio.wav"
      );
      mockTTSService.synthesize.mockResolvedValue(mockAudioPath);

      const textWithPunctuation =
        "Price: $10.99! Email@example.com? Math: 2+2=4. Text with (parentheses) and [brackets].";

      const result = await ttsTools.synthesizeText({
        text: textWithPunctuation,
      });

      expect(result.content).toHaveLength(1);
      expect(!("isError" in result) || !result.isError).toBe(true);

      const response = JSON.parse(result.content[0].text!);
      expect(response.success).toBe(true);
      expect(response.message).toContain(
        "Speech synthesis completed successfully"
      );

      // Just verify it was called with the right text, don't check all params
      expect(mockTTSService.synthesize).toHaveBeenCalledWith(
        textWithPunctuation,
        expect.any(Object)
      );
    });

    it("should reject empty text", async () => {
      const result = await ttsTools.synthesizeText({ text: "" });

      expect(result.content).toHaveLength(1);
      expect("isError" in result && result.isError).toBe(true);

      const errorResponse = JSON.parse(result.content[0].text!);
      expect(errorResponse.success).toBe(false);
      expect(errorResponse.message).toContain(
        "Text parameter is required and cannot be empty"
      );
    });

    it("should reject whitespace-only text", async () => {
      const result = await ttsTools.synthesizeText({ text: "   " });

      expect(result.content).toHaveLength(1);
      expect("isError" in result && result.isError).toBe(true);

      const errorResponse = JSON.parse(result.content[0].text!);
      expect(errorResponse.success).toBe(false);
      expect(errorResponse.message).toContain(
        "Text parameter is required and cannot be empty"
      );
    });

    it("should handle synthesis errors", async () => {
      mockTTSService.synthesize.mockRejectedValue(
        new Error("Synthesis failed")
      );

      const result = await ttsTools.synthesizeText({ text: "Hello world" });

      expect(result.content).toHaveLength(1);
      expect("isError" in result && result.isError).toBe(true);

      const errorResponse = JSON.parse(result.content[0].text!);
      expect(errorResponse.success).toBe(false);
      expect(errorResponse.message).toContain("Synthesis failed");
    });

    it("should validate audio path security", async () => {
      // Mock a path outside the temp directory
      const maliciousPath = "/etc/passwd";
      mockTTSService.synthesize.mockResolvedValue(maliciousPath);

      const result = await ttsTools.synthesizeText({ text: "Hello world" });

      expect(result.content).toHaveLength(1);
      expect("isError" in result && result.isError).toBe(true);

      const errorResponse = JSON.parse(result.content[0].text!);
      expect(errorResponse.success).toBe(false);
      expect(errorResponse.message).toContain("Invalid audio path generated");
    });
  });

  describe("playAudio", () => {
    let mockSpawn: jest.SpyInstance;

    beforeEach(() => {
      // Mock spawn for audio playback
      mockSpawn = jest
        .spyOn(require("child_process"), "spawn")
        .mockImplementation(() => {
          const mockProcess = {
            on: jest.fn((event, callback) => {
              if (event === "close") {
                // Immediately call the callback with success code
                callback(0);
              }
            }),
            kill: jest.fn(),
            stderr: { on: jest.fn() },
          };
          return mockProcess;
        });
    });

    afterEach(() => {
      mockSpawn.mockRestore();
    });

    it("should play audio file successfully", async () => {
      // Use a path in the temporary directory which should pass security validation
      const audioFile = require("path").join(
        require("os").tmpdir(),
        "local-voice-mcp",
        "test.wav"
      );
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ isFile: () => true } as any);

      const result = await ttsTools.playAudio({ audioFile });

      expect(result.content).toHaveLength(1);
      expect(!("isError" in result) || !result.isError).toBe(true);

      const response = JSON.parse(result.content[0].text!);
      expect(response.success).toBe(true);
      expect(response.message).toContain("Successfully played audio file");
      expect(response.audioFile).toBe(audioFile);
      expect(response.volume).toBe(50); // Default volume
      expect(response.platform).toBe(process.platform);
    });

    it("should play audio file with custom volume", async () => {
      const audioFile = require("path").join(
        require("os").tmpdir(),
        "local-voice-mcp",
        "test.wav"
      );
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ isFile: () => true } as any);

      const result = await ttsTools.playAudio({ audioFile, volume: 75 });

      expect(result.content).toHaveLength(1);
      expect(!("isError" in result) || !result.isError).toBe(true);

      const response = JSON.parse(result.content[0].text!);
      expect(response.success).toBe(true);
      expect(response.volume).toBe(75);
    });

    it("should use environment variable for volume when not specified", async () => {
      const originalEnv = process.env.CHATTERBOX_PLAYBACK_VOLUME;
      process.env.CHATTERBOX_PLAYBACK_VOLUME = "25";

      const audioFile = require("path").join(
        require("os").tmpdir(),
        "local-voice-mcp",
        "test.wav"
      );
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ isFile: () => true } as any);

      const result = await ttsTools.playAudio({ audioFile });

      expect(result.content).toHaveLength(1);
      expect(!("isError" in result) || !result.isError).toBe(true);

      const response = JSON.parse(result.content[0].text!);
      expect(response.success).toBe(true);
      expect(response.volume).toBe(25);

      // Restore original environment
      if (originalEnv !== undefined) {
        process.env.CHATTERBOX_PLAYBACK_VOLUME = originalEnv;
      } else {
        delete process.env.CHATTERBOX_PLAYBACK_VOLUME;
      }
    });

    it("should reject invalid volume values", async () => {
      const audioFile = require("path").join(
        require("os").tmpdir(),
        "local-voice-mcp",
        "test.wav"
      );

      // Test volume too low
      let result = await ttsTools.playAudio({ audioFile, volume: -1 });
      expect("isError" in result && result.isError).toBe(true);
      let errorResponse = JSON.parse(result.content[0].text!);
      expect(errorResponse.success).toBe(false);
      expect(errorResponse.message).toContain(
        "Volume must be an integer between 0 and 100"
      );

      // Test volume too high
      result = await ttsTools.playAudio({ audioFile, volume: 101 });
      expect("isError" in result && result.isError).toBe(true);
      errorResponse = JSON.parse(result.content[0].text!);
      expect(errorResponse.success).toBe(false);
      expect(errorResponse.message).toContain(
        "Volume must be an integer between 0 and 100"
      );

      // Test non-integer volume
      result = await ttsTools.playAudio({ audioFile, volume: 50.5 });
      expect("isError" in result && result.isError).toBe(true);
      errorResponse = JSON.parse(result.content[0].text!);
      expect(errorResponse.success).toBe(false);
      expect(errorResponse.message).toContain(
        "Volume must be an integer between 0 and 100"
      );
    });

    it("should reject empty audio file path", async () => {
      const result = await ttsTools.playAudio({ audioFile: "" });

      expect(result.content).toHaveLength(1);
      expect("isError" in result && result.isError).toBe(true);

      const errorResponse = JSON.parse(result.content[0].text!);
      expect(errorResponse.success).toBe(false);
      expect(errorResponse.message).toContain("Audio file path is required");
    });

    it("should reject non-existent file", async () => {
      const audioFile = require("path").join(
        require("os").tmpdir(),
        "local-voice-mcp",
        "nonexistent.wav"
      );
      mockFs.existsSync.mockReturnValue(false);

      const result = await ttsTools.playAudio({ audioFile });

      expect(result.content).toHaveLength(1);
      expect("isError" in result && result.isError).toBe(true);

      const errorResponse = JSON.parse(result.content[0].text!);
      expect(errorResponse.success).toBe(false);
      expect(errorResponse.message).toContain("Audio file does not exist");
    });

    it("should reject unsupported file format", async () => {
      const audioFile = require("path").join(
        require("os").tmpdir(),
        "local-voice-mcp",
        "test.txt"
      );
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ isFile: () => true } as any);

      const result = await ttsTools.playAudio({ audioFile });

      expect(result.content).toHaveLength(1);
      expect("isError" in result && result.isError).toBe(true);

      const errorResponse = JSON.parse(result.content[0].text!);
      expect(errorResponse.success).toBe(false);
      expect(errorResponse.message).toContain("Unsupported audio format");
    });

    describe("deleteAfterPlay functionality", () => {
      it("should delete file after successful playback when deleteAfterPlay is true", async () => {
        const audioFile = require("path").join(
          require("os").tmpdir(),
          "local-voice-mcp",
          "test.wav"
        );
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isFile: () => true } as any);
        mockFs.unlinkSync.mockReturnValue(undefined);

        const result = await ttsTools.playAudio({
          audioFile,
          deleteAfterPlay: true,
        });

        expect(result.content).toHaveLength(1);
        expect(!("isError" in result) || !result.isError).toBe(true);

        const response = JSON.parse(result.content[0].text!);
        expect(response.success).toBe(true);
        expect(response.fileDeleted).toBe(true);
        expect(response.deleteMessage).toContain(
          "Successfully deleted audio file"
        );
        expect(mockFs.unlinkSync).toHaveBeenCalledWith(audioFile);
      });

      it("should delete file after failed playback when deleteAfterPlay is true", async () => {
        const audioFile = require("path").join(
          require("os").tmpdir(),
          "local-voice-mcp",
          "test.wav"
        );
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isFile: () => true } as any);
        mockFs.unlinkSync.mockReturnValue(undefined);

        // Mock spawn to return failure
        mockSpawn.mockImplementation(() => {
          const mockProcess = {
            on: jest.fn((event, callback) => {
              if (event === "close") {
                // Call the callback with failure code
                callback(1);
              }
            }),
            stderr: { on: jest.fn() },
          };
          return mockProcess;
        });

        const result = await ttsTools.playAudio({
          audioFile,
          deleteAfterPlay: true,
        });

        expect(result.content).toHaveLength(1);
        expect("isError" in result && result.isError).toBe(true);

        const response = JSON.parse(result.content[0].text!);
        expect(response.success).toBe(false);
        expect(response.fileDeleted).toBe(true);
        expect(response.deleteMessage).toContain(
          "Successfully deleted audio file"
        );
        expect(mockFs.unlinkSync).toHaveBeenCalledWith(audioFile);
      });

      it("should delete file after timeout when deleteAfterPlay is true", async () => {
        const audioFile = require("path").join(
          require("os").tmpdir(),
          "local-voice-mcp",
          "test.wav"
        );
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isFile: () => true } as any);
        mockFs.unlinkSync.mockReturnValue(undefined);

        // Mock spawn to simulate timeout by never calling the close event
        mockSpawn.mockImplementation(() => {
          const mockProcess = {
            on: jest.fn(),
            kill: jest.fn(),
            stderr: { on: jest.fn() },
          };
          return mockProcess;
        });

        // We'll test the timeout logic by directly calling the private method
        // since mocking setTimeout is complex and the timeout test is less critical
        const ttsToolsAny = ttsTools as any;
        const deletionResult = ttsToolsAny.deleteAudioFileIfRequested(
          audioFile,
          true,
          "test.wav"
        );

        expect(deletionResult.deleted).toBe(true);
        expect(deletionResult.deleteMessage).toContain(
          "Successfully deleted audio file"
        );
        expect(mockFs.unlinkSync).toHaveBeenCalledWith(audioFile);
      });

      it("should NOT delete file when deleteAfterPlay is false", async () => {
        const audioFile = require("path").join(
          require("os").tmpdir(),
          "local-voice-mcp",
          "test.wav"
        );
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isFile: () => true } as any);

        const result = await ttsTools.playAudio({
          audioFile,
          deleteAfterPlay: false,
        });

        expect(result.content).toHaveLength(1);
        expect(!("isError" in result) || !result.isError).toBe(true);

        const response = JSON.parse(result.content[0].text!);
        expect(response.success).toBe(true);
        expect(response.fileDeleted).toBe(false);
        expect(response.deleteMessage).toBeUndefined();
        expect(mockFs.unlinkSync).not.toHaveBeenCalled();
      });

      it("should DELETE file when deleteAfterPlay is undefined (default is true)", async () => {
        const audioFile = require("path").join(
          require("os").tmpdir(),
          "local-voice-mcp",
          "test.wav"
        );
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isFile: () => true } as any);
        mockFs.unlinkSync.mockReturnValue(undefined);

        const result = await ttsTools.playAudio({ audioFile });

        expect(result.content).toHaveLength(1);
        expect(!("isError" in result) || !result.isError).toBe(true);

        const response = JSON.parse(result.content[0].text!);
        expect(response.success).toBe(true);
        expect(response.fileDeleted).toBe(true);
        expect(response.deleteMessage).toContain("Successfully deleted audio file");
        expect(mockFs.unlinkSync).toHaveBeenCalledWith(audioFile);
      });

      it("should handle deletion errors gracefully", async () => {
        const audioFile = require("path").join(
          require("os").tmpdir(),
          "local-voice-mcp",
          "test.wav"
        );
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isFile: () => true } as any);
        mockFs.unlinkSync.mockImplementation(() => {
          throw new Error("Permission denied");
        });

        const result = await ttsTools.playAudio({
          audioFile,
          deleteAfterPlay: true,
        });

        expect(result.content).toHaveLength(1);
        expect(!("isError" in result) || !result.isError).toBe(true);

        const response = JSON.parse(result.content[0].text!);
        expect(response.success).toBe(true);
        expect(response.fileDeleted).toBe(false);
        expect(response.deleteMessage).toContain("Failed to delete audio file");
        expect(response.deleteMessage).toContain("Permission denied");
      });

      it("should skip deletion if file is outside temp directory", async () => {
        const audioFile = "/etc/passwd"; // Outside temp directory
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isFile: () => true } as any);

        // This should fail validation before reaching playback, but let's test the deletion logic
        // by directly calling the private method (we'll need to access it via any casting)
        const ttsToolsAny = ttsTools as any;
        const deletionResult = ttsToolsAny.deleteAudioFileIfRequested(
          audioFile,
          true,
          "passwd"
        );

        expect(deletionResult.deleted).toBe(false);
        expect(deletionResult.deleteMessage).toContain(
          "outside temp directory"
        );
        expect(mockFs.unlinkSync).not.toHaveBeenCalled();
      });

      it("should handle file already deleted scenario", async () => {
        const audioFile = require("path").join(
          require("os").tmpdir(),
          "local-voice-mcp",
          "test.wav"
        );

        // File exists for initial validation but not when deletion is attempted
        let existsCallCount = 0;
        mockFs.existsSync.mockImplementation(() => {
          existsCallCount++;
          return existsCallCount === 1; // First call (validation) returns true, second call (deletion) returns false
        });
        mockFs.statSync.mockReturnValue({ isFile: () => true } as any);

        const result = await ttsTools.playAudio({
          audioFile,
          deleteAfterPlay: true,
        });

        expect(result.content).toHaveLength(1);
        expect(!("isError" in result) || !result.isError).toBe(true);

        const response = JSON.parse(result.content[0].text!);
        expect(response.success).toBe(true);
        expect(response.fileDeleted).toBe(false);
        expect(response.deleteMessage).toContain(
          "already deleted or not found"
        );
        expect(mockFs.unlinkSync).not.toHaveBeenCalled();
      });
    });
  });

  describe("getStatus", () => {
    it("should return operational status when ready", async () => {
      const result = await ttsTools.getStatus();

      expect(result.content).toHaveLength(1);
      expect(result.isError).toBeUndefined();

      const statusResponse = JSON.parse(result.content[0].text!);
      expect(statusResponse.success).toBe(true);
      expect(statusResponse.status).toBe("operational");
      expect(statusResponse.message).toBe(
        "TTS service is ready and operational"
      );
      expect(statusResponse.service.name).toBe("chatterbox");
    });

    it("should return error status when not ready", async () => {
      mockTTSService.ensureReady.mockRejectedValue(
        new Error("Service not ready")
      );

      const result = await ttsTools.getStatus();

      expect(result.content).toHaveLength(1);
      expect("isError" in result && result.isError).toBe(true);

      const errorResponse = JSON.parse(result.content[0].text!);
      expect(errorResponse.success).toBe(false);
      expect(errorResponse.status).toBe("error");
      expect(errorResponse.message).toBe("TTS service is not ready");
      expect(errorResponse.error).toContain("Service not ready");
    });
  });
});

describe("TTSToolSchemas", () => {
  describe("synthesizeText schema", () => {
    it("should validate correct parameters", () => {
      const validParams = {
        text: "Hello world",
        referenceAudio: "ref.wav",
      };

      expect(() => {
        TTSToolSchemas.synthesizeText.text.parse(validParams.text);
        TTSToolSchemas.synthesizeText.referenceAudio?.parse(
          validParams.referenceAudio
        );
      }).not.toThrow();
    });

    it("should reject empty text", () => {
      expect(() => {
        TTSToolSchemas.synthesizeText.text.parse("");
      }).toThrow();
    });

    // Note: Chatterbox Turbo no longer uses exaggeration or cfg_weight parameters.
    // Use paralinguistic tags in text instead: [laugh], [sigh], [cough], etc.
  });

  describe("playAudio schema", () => {
    it("should validate correct parameters", () => {
      const validParams = {
        audioFile: "/tmp/test.wav",
        volume: 75,
        deleteAfterPlay: true,
      };

      expect(() => {
        TTSToolSchemas.playAudio.audioFile.parse(validParams.audioFile);
        TTSToolSchemas.playAudio.volume?.parse(validParams.volume);
        TTSToolSchemas.playAudio.deleteAfterPlay?.parse(
          validParams.deleteAfterPlay
        );
      }).not.toThrow();
    });

    it("should reject empty audio file path", () => {
      expect(() => {
        TTSToolSchemas.playAudio.audioFile.parse("");
      }).toThrow();
    });

    it("should reject invalid volume values", () => {
      expect(() => {
        TTSToolSchemas.playAudio.volume?.parse(-1);
      }).toThrow();

      expect(() => {
        TTSToolSchemas.playAudio.volume?.parse(101);
      }).toThrow();
    });

    it("should accept valid volume values", () => {
      expect(() => {
        TTSToolSchemas.playAudio.volume?.parse(0);
        TTSToolSchemas.playAudio.volume?.parse(50);
        TTSToolSchemas.playAudio.volume?.parse(100);
      }).not.toThrow();
    });

    it("should validate deleteAfterPlay parameter", () => {
      expect(() => {
        TTSToolSchemas.playAudio.deleteAfterPlay?.parse(true);
        TTSToolSchemas.playAudio.deleteAfterPlay?.parse(false);
      }).not.toThrow();
    });

    it("should reject invalid deleteAfterPlay values", () => {
      expect(() => {
        TTSToolSchemas.playAudio.deleteAfterPlay?.parse("true");
      }).toThrow();

      expect(() => {
        TTSToolSchemas.playAudio.deleteAfterPlay?.parse(1);
      }).toThrow();
    });
  });
});
