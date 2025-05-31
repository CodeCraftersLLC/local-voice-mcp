import { TTSTools, TTSToolSchemas } from "../../src/mcp/tools";
import fs from "fs";
import path from "path";

// Mock the ChatterboxService
jest.mock("../../src/core/chatterbox.service", () => ({
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
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe("TTSTools", () => {
  let ttsTools: TTSTools;
  let mockChatterbox: any;

  beforeEach(() => {
    jest.clearAllMocks();

    ttsTools = new TTSTools();
    mockChatterbox = (ttsTools as any).chatterbox;

    // Mock file system operations
    mockFs.existsSync.mockReturnValue(true);
    mockFs.mkdirSync.mockReturnValue(undefined);
  });

  describe("ensureReady", () => {
    it("should call chatterbox ensureReady", async () => {
      await ttsTools.ensureReady();
      expect(mockChatterbox.ensureReady).toHaveBeenCalled();
    });
  });

  describe("synthesizeText", () => {
    it("should synthesize text successfully", async () => {
      const mockAudioPath = require("path").join(
        require("os").tmpdir(),
        "local-voice-mcp",
        "test-audio.wav"
      );
      mockChatterbox.synthesize.mockResolvedValue(mockAudioPath);

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
      mockChatterbox.synthesize.mockResolvedValue(mockAudioPath);

      await ttsTools.synthesizeText({
        text: "Hello world",
        referenceAudio: "ref.wav",
        exaggeration: 0.5,
        cfg_weight: 1.2,
      });

      expect(mockChatterbox.synthesize).toHaveBeenCalledWith("Hello world", {
        referenceAudio: "ref.wav",
        exaggeration: 0.5,
        cfg_weight: 1.2,
      });
    });

    it("should reject empty text", async () => {
      const result = await ttsTools.synthesizeText({ text: "" });

      expect(result.content).toHaveLength(1);
      expect(result.isError).toBe(true);

      const errorResponse = JSON.parse(result.content[0].text!);
      expect(errorResponse.success).toBe(false);
      expect(errorResponse.message).toContain(
        "Text parameter is required and cannot be empty"
      );
    });

    it("should reject whitespace-only text", async () => {
      const result = await ttsTools.synthesizeText({ text: "   " });

      expect(result.content).toHaveLength(1);
      expect(result.isError).toBe(true);

      const errorResponse = JSON.parse(result.content[0].text!);
      expect(errorResponse.success).toBe(false);
      expect(errorResponse.message).toContain(
        "Text parameter is required and cannot be empty"
      );
    });

    it("should handle synthesis errors", async () => {
      mockChatterbox.synthesize.mockRejectedValue(
        new Error("Synthesis failed")
      );

      const result = await ttsTools.synthesizeText({ text: "Hello world" });

      expect(result.content).toHaveLength(1);
      expect(result.isError).toBe(true);

      const errorResponse = JSON.parse(result.content[0].text!);
      expect(errorResponse.success).toBe(false);
      expect(errorResponse.message).toContain("Synthesis failed");
    });

    it("should validate audio path security", async () => {
      // Mock a path outside the temp directory
      const maliciousPath = "/etc/passwd";
      mockChatterbox.synthesize.mockResolvedValue(maliciousPath);

      const result = await ttsTools.synthesizeText({ text: "Hello world" });

      expect(result.content).toHaveLength(1);
      expect(result.isError).toBe(true);

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
          };
          return mockProcess;
        });
    });

    afterEach(() => {
      mockSpawn.mockRestore();
    });

    it("should play audio file successfully", async () => {
      // Use a path in the user's home directory which should pass security validation
      const audioFile = require("path").join(
        require("os").homedir(),
        "test.wav"
      );
      mockFs.existsSync.mockReturnValue(true);

      const result = await ttsTools.playAudio({ audioFile });

      expect(result.content).toHaveLength(1);
      expect(result.isError).toBeFalsy();

      const response = JSON.parse(result.content[0].text!);
      expect(response.success).toBe(true);
      expect(response.message).toContain("Successfully played audio file");
      expect(response.audioFile).toBe(audioFile);
      expect(response.platform).toBe(process.platform);
    });

    it("should reject empty audio file path", async () => {
      const result = await ttsTools.playAudio({ audioFile: "" });

      expect(result.content).toHaveLength(1);
      expect(result.isError).toBe(true);

      const errorResponse = JSON.parse(result.content[0].text!);
      expect(errorResponse.success).toBe(false);
      expect(errorResponse.message).toContain("Audio file path is required");
    });

    it("should reject non-existent file", async () => {
      const audioFile = "/tmp/local-voice-mcp/nonexistent.wav";
      mockFs.existsSync.mockReturnValue(false);

      const result = await ttsTools.playAudio({ audioFile });

      expect(result.content).toHaveLength(1);
      expect(result.isError).toBe(true);

      const errorResponse = JSON.parse(result.content[0].text!);
      expect(errorResponse.success).toBe(false);
      expect(errorResponse.message).toContain("Audio file does not exist");
    });

    it("should reject unsupported file format", async () => {
      const audioFile = "/tmp/local-voice-mcp/test.txt";
      mockFs.existsSync.mockReturnValue(true);

      const result = await ttsTools.playAudio({ audioFile });

      expect(result.content).toHaveLength(1);
      expect(result.isError).toBe(true);

      const errorResponse = JSON.parse(result.content[0].text!);
      expect(errorResponse.success).toBe(false);
      expect(errorResponse.message).toContain("Unsupported audio format");
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
      expect(statusResponse.service.name).toBe("Chatterbox TTS");
    });

    it("should return error status when not ready", async () => {
      mockChatterbox.ensureReady.mockRejectedValue(
        new Error("Service not ready")
      );

      const result = await ttsTools.getStatus();

      expect(result.content).toHaveLength(1);
      expect(result.isError).toBe(true);

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
        exaggeration: 0.5,
        cfg_weight: 1.2,
      };

      expect(() => {
        TTSToolSchemas.synthesizeText.text.parse(validParams.text);
        TTSToolSchemas.synthesizeText.referenceAudio?.parse(
          validParams.referenceAudio
        );
        TTSToolSchemas.synthesizeText.exaggeration?.parse(
          validParams.exaggeration
        );
        TTSToolSchemas.synthesizeText.cfg_weight?.parse(validParams.cfg_weight);
      }).not.toThrow();
    });

    it("should reject empty text", () => {
      expect(() => {
        TTSToolSchemas.synthesizeText.text.parse("");
      }).toThrow();
    });

    it("should reject invalid exaggeration values", () => {
      expect(() => {
        TTSToolSchemas.synthesizeText.exaggeration?.parse(-1);
      }).toThrow();

      expect(() => {
        TTSToolSchemas.synthesizeText.exaggeration?.parse(3);
      }).toThrow();
    });

    it("should reject invalid cfg_weight values", () => {
      expect(() => {
        TTSToolSchemas.synthesizeText.cfg_weight?.parse(-1);
      }).toThrow();

      expect(() => {
        TTSToolSchemas.synthesizeText.cfg_weight?.parse(6);
      }).toThrow();
    });
  });

  describe("playAudio schema", () => {
    it("should validate correct parameters", () => {
      const validParams = {
        audioFile: "/tmp/test.wav",
      };

      expect(() => {
        TTSToolSchemas.playAudio.audioFile.parse(validParams.audioFile);
      }).not.toThrow();
    });

    it("should reject empty audio file path", () => {
      expect(() => {
        TTSToolSchemas.playAudio.audioFile.parse("");
      }).toThrow();
    });
  });
});
