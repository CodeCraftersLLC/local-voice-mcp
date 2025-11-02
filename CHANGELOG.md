# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2025-11-02

### Added

- **Kokoro TTS Engine Support**: Added cross-platform Kokoro TTS engine with multi-language and multi-voice support
  - 40+ voices with gender and accent options
  - Support for multiple languages (en-us, en-gb, fr-fr, it, ja, cmn)
  - Voice blending capability
  - Adjustable speech speed (0.5x to 2.0x)
  - GPU support via ONNX runtime
  - Long-form content support with no length limitations
- **Zero-Config Setup for Kokoro**: Automatic installation of Python dependencies and model files
  - Auto-installs `kokoro-onnx`, `soundfile`, and `numpy` packages
  - Auto-downloads model files (~100MB) to `~/.cache/kokoro-tts/`
  - No manual terminal commands required
- **Plugin-Based TTS Architecture**: Refactored to support multiple TTS engines via `ITTSEngine` interface
  - Factory pattern for engine selection via `TTS_ENGINE` environment variable
  - Modular design allowing easy addition of new engines
- **Engine-Specific Configuration**: Added Kokoro-specific environment variables and MCP tool parameters
  - `KOKORO_SPEED`, `KOKORO_LANGUAGE`, `KOKORO_VOICE`
  - `KOKORO_MODEL_PATH`, `KOKORO_VOICES_PATH`
  - `KOKORO_MAX_CHARACTERS` (default: 5000)
- **Enhanced Error Recovery**: Improved retry logic in `ensureReady()` methods
  - Failed setup attempts now allow retries on subsequent calls
  - No stale rejected promises cached
- **Comprehensive Documentation**: Added detailed docs for Kokoro integration
  - `KOKORO_INTEGRATION.md` with implementation details
  - `KOKORO_AUTO_DOWNLOAD.md` explaining automatic setup
  - `ZERO_CONFIG_SETUP.md` for user-friendly setup guide

### Changed

- **Engine Selection**: TTS engine now configurable via `TTS_ENGINE` environment variable (default: "chatterbox")
- **Character Limits**: Now engine-specific (Chatterbox: 2000, Kokoro: 5000)
- **MCP Tool Schema**: Updated `synthesize_text` tool to support both Chatterbox and Kokoro parameters
- **API Responses**: Enhanced to include engine-specific information and filtered undefined options
- **Download Progress Logging**: Throttled to every 10% to reduce log spam during model downloads
- **HTTP Redirect Handling**: Added support for HTTP 307/308 redirects in file downloads

### Removed

- **Kani-MLX Engine**: Removed all Kani-MLX code, files, and documentation
  - Deleted `kani-mlx.engine.ts`, `kani_runner.py`, `requirements-kani-mlx.txt`
  - Removed Kani-MLX specific options from interfaces and tools
  - Cleaned up tests and documentation

### Fixed

- **Retry Logic**: Fixed `ensureReady()` in both `TTSService` and individual engines to properly clear failed promises
- **Character Limit Validation**: Corrected bug where server always used Chatterbox limit regardless of active engine
- **Unused Imports**: Removed unused `ChildProcess` from `kokoro.engine.ts` and `numpy` from `kokoro_runner.py`
- **Kokoro API Validation**: Removed invalid `get_languages()` and `get_voices()` calls that don't exist in `kokoro-onnx`
- **Python Import Order**: Moved `traceback` import to top of `kokoro_runner.py` for PEP 8 compliance
- **Options Response**: Properly filter undefined values from MCP tool response options

### Security

- **Path Validation**: Continued robust path validation and sanitization across all engines
- **Directory Traversal Prevention**: Maintained security measures for file operations

## [0.1.4] - 2025-06-02

### Added

- `deleteAfterPlay` parameter to `play_audio` command for automatic file cleanup after playback
- Secure file deletion functionality that only operates on files in the temporary directory
- Comprehensive file cleanup in all playback scenarios (success, failure, timeout, error)
- Enhanced response format including `fileDeleted` status and `deleteMessage` details
- Extensive test coverage for the new file cleanup functionality

### Changed

- Updated `play_audio` tool schema to include optional `deleteAfterPlay` boolean parameter
- Enhanced audio playback responses to include deletion status information
- Improved logging for file deletion operations

### Security

- Added security validation to ensure only files in temp directory can be deleted
- Implemented graceful error handling for deletion failures to prevent application crashes

## [0.1.3] - 2025-06-01

### Added

- `USE_MALE_VOICE` environment variable to use default male voice instead of bundled female reference voice
- Option to choose between bundled female voice (default) and default male voice without needing custom reference audio
- Comprehensive test coverage for male/female voice selection functionality

### Changed

- Updated README with examples showing how to use male voice option
- Enhanced documentation to clarify voice selection behavior

## [0.1.2] - 2025-06-01

### Added

- Bundled high-quality female reference voice that's used by default when no reference audio is specified
- Automatic fallback to bundled reference audio when specified reference audio files fail validation
- New `getBundledReferenceAudioPath()` method in ChatterboxService for accessing the bundled reference audio

### Changed

- Improved user experience: no configuration needed for high-quality voice synthesis out of the box
- Updated README to reflect that bundled reference audio is used by default
- Updated environment variable documentation to clarify default behavior

### Fixed

- Resolved issue where relative paths to reference audio files in npm package didn't work correctly
- Improved reference audio path resolution using `__dirname` for reliable package-relative paths

## [0.1.1] - 2025-06-01

### Fixed

- Missing `scripts/` directory in published npm package causing "No such file or directory" errors when running the MCP server

## [0.1.0] - 2024-06-01

### Added

- Initial release
- MCP server implementation
- Text-to-speech synthesis using Chatterbox TTS
- Audio playback functionality
- HTTP and stdio server modes
- Comprehensive test suite
- Security features for file path validation
- Environment variable support for TTS configuration
- `CHATTERBOX_REFERENCE_AUDIO` environment variable
- `CHATTERBOX_EXAGGERATION` environment variable
- `CHATTERBOX_CFG_WEIGHT` environment variable
- Comprehensive publishing documentation
- GitHub Actions workflow for automated publishing
- Female reference voice audio file included in package

### Changed

- Package name updated to `@codecraftersllc/local-voice-mcp`
- README examples updated to use scoped package name
- Improved argument sanitization to allow file paths

### Fixed

- Directory traversal security vulnerabilities
- Command injection prevention
- Duplicate reference audio arguments issue
