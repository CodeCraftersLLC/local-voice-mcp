/**
 * TTS Engine Constants
 * 
 * Centralized configuration constants for all TTS engines
 */

// Common Constants
export const COMMON_CONSTANTS = {
  TEMP_DIR_NAME: "local-voice-mcp",
  ALLOWED_AUDIO_EXTENSIONS: [".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"],
  PYTHON_DEFAULT_PATH: "python3",
} as const;

// Audio Configuration
export const AUDIO_CONFIG = {
  SAMPLE_RATE: 22050,
  CODEBOOK_SIZE: 4032,
} as const;

// Chatterbox TTS Constants
export const CHATTERBOX_DEFAULTS = {
  MAX_CHARACTERS: 2000,
  EXAGGERATION: 0.2,
  CFG_WEIGHT: 1.0,
  PLAYBACK_VOLUME: 50,
} as const;

export const CHATTERBOX_LIMITS = {
  EXAGGERATION_MIN: 0,
  EXAGGERATION_MAX: 2,
  CFG_WEIGHT_MIN: 0,
  CFG_WEIGHT_MAX: 5,
  VOLUME_MIN: 0,
  VOLUME_MAX: 100,
} as const;

// Kokoro TTS Constants
export const KOKORO_DEFAULTS = {
  MAX_CHARACTERS: 5000,  // Much higher limit than Chatterbox
  SPEED: 1.0,
  LANGUAGE: "en-us",
  VOICE: "af_sarah",
  MODEL_PATH: "kokoro-v1.0.onnx",
  VOICES_PATH: "voices-v1.0.bin",
} as const;

export const KOKORO_LIMITS = {
  SPEED_MIN: 0.5,
  SPEED_MAX: 2.0,
} as const;
