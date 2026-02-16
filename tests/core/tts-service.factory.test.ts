// Mock child_process to avoid actual Python execution in tests
jest.mock("child_process", () => ({
  spawn: jest.fn(),
  exec: jest.fn(),
}));

import { TTSService } from "../../src/core/tts-service.factory";

describe("TTSService", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe("Engine Selection", () => {
    it("should default to chatterbox engine when TTS_ENGINE is not set", () => {
      delete process.env.TTS_ENGINE;
      const service = new TTSService();
      expect(service.getEngineType()).toBe("chatterbox");
      expect(service.getEngineName()).toBe("chatterbox");
    });

    it("should use chatterbox engine when TTS_ENGINE is set to chatterbox", () => {
      process.env.TTS_ENGINE = "chatterbox";
      const service = new TTSService();
      expect(service.getEngineType()).toBe("chatterbox");
      expect(service.getEngineName()).toBe("chatterbox");
    });

    it("should use kokoro engine when TTS_ENGINE is set to kokoro", () => {
      process.env.TTS_ENGINE = "kokoro";
      const service = new TTSService();
      expect(service.getEngineType()).toBe("kokoro");
      expect(service.getEngineName()).toBe("kokoro");
    });

    it("should default to chatterbox for unknown engine types", () => {
      process.env.TTS_ENGINE = "unknown-engine";
      const service = new TTSService();
      expect(service.getEngineType()).toBe("chatterbox");
      expect(service.getEngineName()).toBe("chatterbox");
    });

    it("should handle case-insensitive engine names", () => {
      process.env.TTS_ENGINE = "KOKORO";
      const service = new TTSService();
      expect(service.getEngineType()).toBe("kokoro");
    });

    it("should use kani engine when TTS_ENGINE is set to kani", () => {
      process.env.TTS_ENGINE = "kani";
      const service = new TTSService();
      expect(service.getEngineType()).toBe("kani");
      expect(service.getEngineName()).toBe("kani");
    });

    it("should handle case-insensitive kani engine name", () => {
      process.env.TTS_ENGINE = "KANI";
      const service = new TTSService();
      expect(service.getEngineType()).toBe("kani");
    });
  });

  describe("Engine Interface", () => {
    it("should provide getStatus method", async () => {
      const service = new TTSService();
      const status = await service.getStatus();
      
      expect(status).toHaveProperty("ready");
      expect(status).toHaveProperty("capabilities");
      expect(status).toHaveProperty("engineName");
      expect(Array.isArray(status.capabilities)).toBe(true);
    });

    it("should return chatterbox capabilities for default engine", async () => {
      delete process.env.TTS_ENGINE;
      const service = new TTSService();
      const status = await service.getStatus();

      expect(status.engineName).toBe("chatterbox");
      expect(status.capabilities).toContain("voice-cloning");
      expect(status.capabilities).toContain("paralinguistic-tags");
      expect(status.capabilities).toContain("multi-architecture");
    });

    it("should return kokoro capabilities when kokoro is selected", async () => {
      process.env.TTS_ENGINE = "kokoro";
      const service = new TTSService();
      const status = await service.getStatus();

      expect(status.engineName).toBe("kokoro");
      expect(status.capabilities).toContain("multi-language");
      expect(status.capabilities).toContain("multi-voice");
    });

    it("should return kani capabilities when kani is selected", async () => {
      process.env.TTS_ENGINE = "kani";
      const service = new TTSService();
      const status = await service.getStatus();

      expect(status.engineName).toBe("kani");
      expect(status.capabilities).toContain("voice-cloning");
      expect(status.capabilities).toContain("speaker-embeddings");
      expect(status.capabilities).toContain("temperature-control");
      expect(status.capabilities).toContain("huggingface-models");
    });
  });

  describe("Validation", () => {
    it("should validate Chatterbox-specific options", () => {
      const service = new TTSService();

      // Valid options should not throw (Chatterbox Turbo no longer uses exaggeration/cfg_weight)
      expect(() => {
        service["engine"].validateOptions({
          referenceAudio: "/path/to/audio.wav",
        });
      }).not.toThrow();

      // Note: Chatterbox Turbo uses paralinguistic tags in text instead of
      // exaggeration/cfg_weight parameters: [laugh], [sigh], [cough], etc.
    });

    it("should validate Kokoro-specific options", () => {
      process.env.TTS_ENGINE = "kokoro";
      const service = new TTSService();

      // Valid options should not throw
      expect(() => {
        service["engine"].validateOptions({
          speed: 1.0,
          language: "en-us",
        });
      }).not.toThrow();

      // Invalid speed should throw
      expect(() => {
        service["engine"].validateOptions({
          speed: 3.0, // Out of range
        });
      }).toThrow();
    });

    it("should validate Kani-specific options", () => {
      process.env.TTS_ENGINE = "kani";
      const service = new TTSService();

      // Valid options should not throw
      expect(() => {
        service["engine"].validateOptions({
          temperature: 0.7,
          top_p: 0.95,
          repetition_penalty: 1.1,
        });
      }).not.toThrow();

      // Invalid temperature should throw
      expect(() => {
        service["engine"].validateOptions({
          temperature: 1.5, // Out of range
        });
      }).toThrow();

      // Invalid top_p should throw
      expect(() => {
        service["engine"].validateOptions({
          top_p: -0.1, // Out of range
        });
      }).toThrow();

      // Invalid repetition_penalty should throw
      expect(() => {
        service["engine"].validateOptions({
          repetition_penalty: 0.5, // Out of range (min is 1.0)
        });
      }).toThrow();
    });

    it("should accept valid Kani voice cloning options", () => {
      process.env.TTS_ENGINE = "kani";
      const service = new TTSService();

      expect(() => {
        service["engine"].validateOptions({
          referenceAudio: "/path/to/reference.wav",
          temperature: 0.5,
        });
      }).not.toThrow();
    });
  });
});
