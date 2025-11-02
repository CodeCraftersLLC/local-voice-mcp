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
      expect(status.capabilities).toContain("prosody-control");
    });

    it("should return kokoro capabilities when kokoro is selected", async () => {
      process.env.TTS_ENGINE = "kokoro";
      const service = new TTSService();
      const status = await service.getStatus();
      
      expect(status.engineName).toBe("kokoro");
      expect(status.capabilities).toContain("multi-language");
      expect(status.capabilities).toContain("multi-voice");
    });
  });

  describe("Validation", () => {
    it("should validate Chatterbox-specific options", () => {
      const service = new TTSService();
      
      // Valid options should not throw
      expect(() => {
        service["engine"].validateOptions({
          exaggeration: 0.5,
          cfg_weight: 1.0,
        });
      }).not.toThrow();

      // Invalid exaggeration should throw
      expect(() => {
        service["engine"].validateOptions({
          exaggeration: 3.0, // Out of range
        });
      }).toThrow();
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
  });
});
