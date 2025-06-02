# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] - 2025-01-02

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

## [0.1.1] - 2025-01-02

### Fixed

- Missing `scripts/` directory in published npm package causing "No such file or directory" errors when running the MCP server

## [0.1.0] - 2024-01-XX

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
