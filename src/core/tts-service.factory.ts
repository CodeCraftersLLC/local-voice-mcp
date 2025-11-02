/**
 * TTS Service Factory
 * 
 * Provides a centralized service for TTS operations that automatically
 * selects and manages the appropriate TTS engine based on configuration.
 */

import { ITTSEngine, TTSOptions, TTSEngineStatus } from "./tts-engine.interface";
import { ChatterboxEngine } from "./chatterbox.engine";
import { KokoroEngine } from "./kokoro.engine";
import { logger } from "../utils/logger";

export type TTSEngineType = "chatterbox" | "kokoro";

export class TTSService {
  private engine: ITTSEngine;
  private engineType: TTSEngineType;
  private readyPromise: Promise<void> | null = null;

  constructor() {
    // Read engine type from environment variable, default to chatterbox
    const envEngine = process.env.TTS_ENGINE?.toLowerCase();
    
    // Validate and set engine type
    if (envEngine === "kokoro") {
      this.engineType = "kokoro";
    } else if (envEngine && envEngine !== "chatterbox") {
      logger.warn(
        `Unknown TTS engine: ${envEngine}. Defaulting to chatterbox.`
      );
      this.engineType = "chatterbox";
    } else {
      this.engineType = "chatterbox";
    }

    // Instantiate the appropriate engine
    switch (this.engineType) {
      case "chatterbox":
        this.engine = new ChatterboxEngine();
        break;
      case "kokoro":
        this.engine = new KokoroEngine();
        break;
      default:
        // This should never happen due to validation above
        logger.error(`Invalid engine type: ${this.engineType}`);
        this.engineType = "chatterbox";
        this.engine = new ChatterboxEngine();
    }

    logger.log(`[TTSService] Initialized with ${this.engineType} engine`);
  }

  /**
   * Ensure the selected engine is ready for use
   * This method is idempotent - multiple calls will return the same promise
   */
  async ensureReady(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.engine.ensureReady();
    }
    return this.readyPromise;
  }

  /**
   * Synthesize text using the selected engine
   */
  async synthesize(text: string, options: TTSOptions): Promise<string> {
    await this.ensureReady();
    this.engine.validateOptions(options);
    return this.engine.synthesize(text, options);
  }

  /**
   * Get status of the current engine
   */
  async getStatus(): Promise<TTSEngineStatus> {
    return this.engine.getStatus();
  }

  /**
   * Cleanup resources when shutting down
   */
  async shutdown(): Promise<void> {
    await this.engine.shutdown();
  }

  /**
   * Get the current engine type
   */
  getEngineType(): TTSEngineType {
    return this.engineType;
  }

  /**
   * Get the engine name (for display purposes)
   */
  getEngineName(): string {
    return this.engine.engineName;
  }
}

