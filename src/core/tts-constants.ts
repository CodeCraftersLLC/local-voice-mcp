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

// Chatterbox Turbo TTS Constants
// Note: Chatterbox Turbo no longer uses exaggeration or cfg_weight.
// Use paralinguistic tags in text instead: [laugh], [sigh], [cough], [chuckle], [gasp], [groan], etc.
export const CHATTERBOX_DEFAULTS = {
  MAX_CHARACTERS: 2000,
  PLAYBACK_VOLUME: 50,
} as const;

export const CHATTERBOX_LIMITS = {
  VOLUME_MIN: 0,
  VOLUME_MAX: 100,
} as const;

// Supported paralinguistic tags for Chatterbox Turbo
export const CHATTERBOX_PARALINGUISTIC_TAGS = [
  "[clear throat]",
  "[sigh]",
  "[shush]",
  "[cough]",
  "[groan]",
  "[sniff]",
  "[gasp]",
  "[chuckle]",
  "[laugh]",
] as const;

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

// Kani TTS 2 Constants
export const KANI_DEFAULTS = {
  MAX_CHARACTERS: 2000,
  MODEL: "nineninesix/kani-tts-2-en",
  TEMPERATURE: 1.0,
  TOP_P: 0.95,
  REPETITION_PENALTY: 1.1,
} as const;

export const KANI_LIMITS = {
  TEMPERATURE_MIN: 0.0,
  TEMPERATURE_MAX: 1.0,
  TOP_P_MIN: 0.0,
  TOP_P_MAX: 1.0,
  REPETITION_PENALTY_MIN: 1.0,
  REPETITION_PENALTY_MAX: 2.0,
} as const;
