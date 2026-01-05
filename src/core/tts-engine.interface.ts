/**
 * TTS Engine Interface
 * 
 * Defines a common contract for all TTS engines to implement.
 * This enables a plugin-based architecture where different TTS
 * engines can be swapped without changing application code.
 */

export interface TTSOptions {
  referenceAudio?: string;

  // Kokoro-specific options
  speed?: number;
  language?: string;
  voice?: string;
  model_path?: string;
  voices_path?: string;

  // Note: Chatterbox Turbo no longer uses exaggeration or cfg_weight parameters.
  // Instead, use paralinguistic tags directly in the text, e.g.:
  // "[laugh]", "[sigh]", "[cough]", "[chuckle]", "[gasp]", "[groan]", etc.
}

export interface TTSEngineStatus {
  ready: boolean;
  capabilities: string[];
  version?: string;
  engineName: string;
}

/**
 * Interface that all TTS engines must implement
 */
export interface ITTSEngine {
  /**
   * Engine identifier (e.g., "chatterbox", "kokoro")
   */
  readonly engineName: string;

  /**
   * Ensure the engine is ready for synthesis
   * This should handle any initialization, dependency checks, or model loading
   */
  ensureReady(): Promise<void>;

  /**
   * Synthesize text to speech
   * @param text - Text to synthesize
   * @param options - Engine-specific options
   * @returns Path to generated audio file
   */
  synthesize(text: string, options: TTSOptions): Promise<string>;

  /**
   * Get engine capabilities and status
   */
  getStatus(): Promise<TTSEngineStatus>;

  /**
   * Validate engine-specific options
   * @throws Error if options are invalid
   */
  validateOptions(options: TTSOptions): void;

  /**
   * Cleanup resources when engine is no longer needed
   */
  shutdown(): Promise<void>;
}

