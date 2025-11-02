# Local Voice MCP

Give your MCP clients the ability to speak by running local voice models using Chatterbox TTS or Kokoro TTS.

## Quickstart

The package includes a high-quality female reference voice that's used by default with Chatterbox TTS. All environment variables are optional.

```json
{
  "mcpServers": {
    "local-voice-mcp": {
      "command": "npx",
      "args": ["-y", "@codecraftersllc/local-voice-mcp"],
      "env": {
        "USE_MALE_VOICE": "false",
        "CHATTERBOX_EXAGGERATION": "0.5",
        "CHATTERBOX_CFG_WEIGHT": "1.2",
        "CHATTERBOX_MAX_CHARACTERS": "2000",
        "CHATTERBOX_PLAYBACK_VOLUME": "75"
      }
    }
  }
}
```

## TTS Engine Selection

Local Voice MCP supports two TTS engines:

### Chatterbox TTS (Default)

High-quality voice synthesis with voice cloning support. Works on all platforms.

- ✅ Cross-platform support (macOS, Windows, Linux)
- ✅ Voice cloning with reference audio
- ✅ Prosody controls (exaggeration, cfg_weight)
- ✅ High-quality output

### Kokoro TTS (Cross-Platform)

High-quality open-source TTS using ONNX runtime with multi-language and multi-voice support.

- ✅ Cross-platform (macOS, Windows, Linux)
- ✅ Multiple languages (en-us, en-gb, fr-fr, it, ja, cmn)
- ✅ 40+ voices with gender and accent options
- ✅ Voice blending capability
- ✅ Adjustable speech speed
- ✅ GPU support
- ✅ Long-form content (no length limitations)
- ✅ **Automatic dependency and model installation** (nothing to install manually!)

To use Kokoro, set the `TTS_ENGINE` environment variable:

```json
{
  "mcpServers": {
    "local-voice-mcp": {
      "command": "npx",
      "args": ["-y", "@codecraftersllc/local-voice-mcp"],
      "env": {
        "TTS_ENGINE": "kokoro",
        "KOKORO_LANGUAGE": "en-us",
        "KOKORO_VOICE": "af_sarah",
        "KOKORO_SPEED": "1.0"
      }
    }
  }
}
```

**Setup:**

Kokoro TTS automatically installs Python dependencies and downloads model files (~100MB) on first use. Just configure the MCP server and you're ready to go!

**What Happens on First Use:**

- Python packages (`kokoro-onnx`, `soundfile`, `numpy`) are automatically installed via pip
- Model files (`kokoro-v1.0.onnx` ~90MB, `voices-v1.0.bin` ~13MB) are automatically downloaded
- Files are cached in `~/.cache/kokoro-tts/` for future use
- This one-time setup takes ~1-2 minutes depending on your internet connection

**Manual Installation (Optional):**

If you prefer to install dependencies manually or if automatic installation fails:

```bash
# Install Python dependencies
pip install kokoro-onnx soundfile numpy

# Model files will still auto-download, or you can download manually:
cd ~/.cache/kokoro-tts
wget https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx
wget https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin
```

**Available Voices:**

- 🇺🇸 American English: `af_alloy`, `af_bella`, `af_sarah`, `af_nova`, `am_adam`, `am_michael`, `am_eric`, and more
- 🇬🇧 British English: `bf_emma`, `bf_isabella`, `bm_george`, `bm_lewis`, and more
- 🇫🇷 French: `ff_siwis`
- 🇮🇹 Italian: `if_sara`, `im_nicola`
- 🇯🇵 Japanese: `jf_alpha`, `jm_kumo`, and more
- 🇨🇳 Chinese: `zf_xiaobei`, `zm_yunjian`, and more

**Voice Blending:**
Kokoro supports blending multiple voices for unique voice characteristics:

```bash
# 60-40 mix of two voices
KOKORO_VOICE="af_sarah:60,am_adam:40"

# Equal blend (50-50)
KOKORO_VOICE="am_adam,af_sarah"
```

## Features

- **MCP Server Implementation**: Full Model Context Protocol server using `@modelcontextprotocol/sdk`
- **HTTP API**: ElevenLabs-compatible REST API for direct integration
- **Text-to-Speech Synthesis**: High-quality voice synthesis using Chatterbox TTS
- **Voice Cloning**: Support for reference audio for voice cloning
- **Prosody Controls**: Adjustable exaggeration and configuration weights
- **Volume Control**: Configurable audio playback volume with cross-platform support
- **Robust File Management**: Automatic cleanup of temporary audio files
- **Security**: Path validation and sanitization to prevent directory traversal
- **Dual Mode Operation**: Run as MCP server or HTTP server

## Installation

### From npm (Recommended)

```bash
npm install -g local-voice-mcp
```

### From Source

```bash
git clone <repository-url>
cd local-voice-mcp
npm install
npm run build
```

## Usage

### MCP Server Mode (Default)

Run as an MCP server with stdio transport:

```bash
local-voice-mcp-server
```

Or using npx:

```bash
npx local-voice-mcp-server
```

### HTTP Server Mode

Run as an HTTP server:

```bash
MCP_MODE=http local-voice-mcp-server
```

Or set the port:

```bash
PORT=3000 MCP_MODE=http local-voice-mcp-server
```

### Development

```bash
# Run MCP server in development
npm run dev:mcp

# Run HTTP server in development
npm run dev:http

# Run tests
npm test

# Build project
npm run build
```

## MCP Tools

When running in MCP mode, the following tools are available:

### `synthesize_text`

Converts text to speech and returns audio data using the configured TTS engine.

**Common Parameters:**

- `text` (string, required): Text to synthesize

**Chatterbox-Specific Parameters:**

- `referenceAudio` (string, optional): Path to reference audio for voice cloning
- `exaggeration` (number, optional): Voice style exaggeration (0-2, default: 0.2)
- `cfg_weight` (number, optional): Configuration weight (0-5, default: 1.0)

**Kokoro-Specific Parameters:**

- `speed` (number, optional): Speech speed (0.5-2.0, default: 1.0)
- `language` (string, optional): Language code (e.g., 'en-us', 'en-gb', 'fr-fr', 'ja', 'cmn', default: 'en-us')
- `voice` (string, optional): Voice name (e.g., 'af_sarah', 'am_adam', 'bf_emma', default: 'af_sarah')
- `model_path` (string, optional): Path to Kokoro ONNX model file
- `voices_path` (string, optional): Path to Kokoro voices bin file

**Returns:**

- JSON response with synthesis status and file path

**Example Response:**

```json
{
  "success": true,
  "message": "Speech synthesis completed successfully",
  "audioFile": "/tmp/local-voice-mcp/audio_20240115_103000_abc123.wav",
  "textLength": 25,
  "audioFormat": "wav",
  "engine": "chatterbox",
  "engineName": "chatterbox",
  "options": {
    "exaggeration": 0.2,
    "cfg_weight": 1.0
  },
  "generatedAt": "2024-01-15T10:30:00.000Z"
}
```

The audio file is saved to the temporary directory and can be played using any audio player or accessed programmatically.

### `play_audio`

Play an audio file using the system's default audio player with optional volume control.

**Parameters:**

- `audioFile` (string, required): Path to the audio file to play
- `volume` (number, optional): Playback volume as percentage (0-100). If not specified, uses CHATTERBOX_PLAYBACK_VOLUME environment variable or default of 50.

**Supported Formats:**

- WAV files (.wav)
- MP3 files (.mp3)

**Returns:**

- JSON response with playback status and system information

**Example Response:**

```json
{
  "success": true,
  "message": "Successfully played audio file: /tmp/local-voice-mcp/audio_123.wav",
  "audioFile": "/tmp/local-voice-mcp/audio_123.wav",
  "volume": 50,
  "platform": "darwin",
  "command": "afplay -v 0.5 /tmp/local-voice-mcp/audio_123.wav",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Platform Support:**

- **Cross-platform**: Prefers `ffplay` (from ffmpeg) for consistent volume control across all platforms
- **macOS**: Falls back to `afplay` command with `-v` volume flag
- **Windows**: Falls back to PowerShell with `MediaPlayer` and volume control
- **Linux**: Falls back to `mpg123` (MP3) with gain control or `aplay` (WAV, no volume control)

### `tts_status`

Returns the current status of the TTS service.

**Parameters:** None

**Returns:**

- JSON response with service status and capabilities

**Example Response:**

```json
{
  "success": true,
  "status": "operational",
  "message": "TTS service is ready and operational",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "service": {
    "name": "Chatterbox TTS",
    "version": "0.1.0",
    "capabilities": [
      "text-to-speech synthesis",
      "voice cloning with reference audio",
      "prosody controls"
    ]
  }
}
```

## MCP Resources

### `service-info`

Provides information about the Local Voice MCP service.

**URI:** `local-voice://service-info`

## HTTP API

When running in HTTP mode, the server exposes:

### `POST /tts`

ElevenLabs-compatible text-to-speech endpoint.

**Headers:**

- `X-API-Key`: API key (placeholder for authentication)
- `Content-Type`: application/json

**Request Body:**

```json
{
  "text": "Hello, world!",
  "options": {
    "referenceAudio": "path/to/reference.wav",
    "exaggeration": 0.5,
    "cfg_weight": 1.2
  }
}
```

**Response:**

- Content-Type: `audio/wav`
- Binary audio data

## Configuration

### Environment Variables

#### Server Configuration

- `PORT`: HTTP server port (default: 59125)
- `MCP_MODE`: Operation mode - "mcp" or "http" (default: "mcp")

#### TTS Engine Selection

- `TTS_ENGINE`: TTS engine to use - "chatterbox", "kani-mlx", or "kokoro" (default: "chatterbox")

#### Chatterbox TTS Configuration

These environment variables can be used to set default values for Chatterbox TTS synthesis. They will be used if not overridden by options passed to the synthesize method:

- `CHATTERBOX_REFERENCE_AUDIO`: Path to reference audio file for voice cloning (can be anywhere on your system, supports .wav, .mp3, .flac, .ogg, .m4a, .aac). If not specified, uses the bundled high-quality female reference voice.
- `USE_MALE_VOICE`: Use male voice instead of bundled female reference voice (true/false, default: false). When set to true, uses the default Chatterbox male voice instead of the bundled female voice. This only applies when no custom reference audio is specified.
- `CHATTERBOX_EXAGGERATION`: Voice style exaggeration level (float, default: 0.2)
- `CHATTERBOX_CFG_WEIGHT`: Configuration weight for TTS model (float, default: 1.0)
- `CHATTERBOX_MAX_CHARACTERS`: Maximum number of characters allowed for text input (integer, default: 2000)
- `CHATTERBOX_OUTPUT_DIR`: Output directory for generated audio files (default: system temp + "local-voice-mcp")
- `CHATTERBOX_PLAYBACK_VOLUME`: Default audio playback volume as percentage (integer, 0-100, default: 50)

#### Kokoro Configuration

These environment variables can be used to set default values for Kokoro synthesis:

- `KOKORO_SPEED`: Speech speed (float, 0.5-2.0, default: 1.0)
- `KOKORO_LANGUAGE`: Language code (string, default: "en-us"). Supported: en-us, en-gb, fr-fr, it, ja, cmn
- `KOKORO_VOICE`: Voice name (string, default: "af_sarah"). See available voices above. Can also use voice blending format like "voice1:weight,voice2:weight"
- `KOKORO_MODEL_PATH`: Path to kokoro ONNX model file (string, default: "kokoro-v1.0.onnx")
- `KOKORO_VOICES_PATH`: Path to voices bin file (string, default: "voices-v1.0.bin")
- `KOKORO_MAX_CHARACTERS`: Maximum number of characters allowed for text input (integer, default: 5000)
- `KOKORO_OUTPUT_DIR`: Output directory for generated audio files (default: system temp + "local-voice-mcp")
- `PYTHON_PATH`: Path to Python interpreter (default: "python3")

**Example:**

```bash
# Set default TTS parameters via environment variables
# Reference audio can be anywhere on your system
export CHATTERBOX_REFERENCE_AUDIO="/Users/john/Music/my-voice.wav"
export CHATTERBOX_EXAGGERATION="0.5"
export CHATTERBOX_CFG_WEIGHT="1.2"
export CHATTERBOX_MAX_CHARACTERS="3000"
export CHATTERBOX_PLAYBACK_VOLUME="75"

# Run the MCP server with these defaults
local-voice-mcp-server
```

**Using with npx:**

```json
{
  "mcpServers": {
    "local-voice-mcp": {
      "command": "npx",
      "args": ["-y", "@codecraftersllc/local-voice-mcp"],
      "env": {
        "CHATTERBOX_REFERENCE_AUDIO": "/Users/john/Music/my-voice.wav",
        "CHATTERBOX_EXAGGERATION": "0.5",
        "CHATTERBOX_CFG_WEIGHT": "1.2",
        "CHATTERBOX_MAX_CHARACTERS": "3000",
        "CHATTERBOX_PLAYBACK_VOLUME": "75"
      }
    }
  }
}
```

**Using male voice instead of bundled female voice:**

```json
{
  "mcpServers": {
    "local-voice-mcp": {
      "command": "npx",
      "args": ["-y", "@codecraftersllc/local-voice-mcp"],
      "env": {
        "USE_MALE_VOICE": "true",
        "CHATTERBOX_EXAGGERATION": "0.3",
        "CHATTERBOX_CFG_WEIGHT": "1.0"
      }
    }
  }
}
```

**Priority Order:**

1. Options passed to the `synthesize_text` or `play_audio` tools (highest priority)
2. Environment variables
3. Built-in defaults (lowest priority)

### MCP Client Configuration

Add to your MCP client configuration:

```json
{
  "local-voice-mcp": {
    "command": "npx",
    "args": ["-y", "local-voice-mcp-server"],
    "env": {}
  }
}
```

## Testing with Cursor

Cursor is a popular AI-powered code editor that supports MCP. Here's how to test the Local Voice MCP server with Cursor:

### 1. Install the Package

First, install the package globally or ensure it's available:

```bash
npm install -g local-voice-mcp
# or
npm install local-voice-mcp
```

### 2. Configure Cursor

Add the MCP server to your Cursor configuration file. The location depends on your operating system:

- **macOS**: `~/Library/Application Support/Cursor/User/globalStorage/cursor.mcp/config.json`
- **Windows**: `%APPDATA%\Cursor\User\globalStorage\cursor.mcp\config.json`
- **Linux**: `~/.config/Cursor/User/globalStorage/cursor.mcp/config.json`

Add this configuration:

```json
{
  "mcpServers": {
    "local-voice-mcp": {
      "command": "local-voice-mcp-server",
      "args": [],
      "env": {}
    }
  }
}
```

Or if using npx:

```json
{
  "mcpServers": {
    "local-voice-mcp": {
      "command": "npx",
      "args": ["-y", "local-voice-mcp-server"],
      "env": {}
    }
  }
}
```

### 3. Restart Cursor

After adding the configuration, restart Cursor to load the MCP server.

### 4. Test the Integration

Once Cursor is restarted, you can test the TTS functionality:

1. **Open Cursor's AI chat**
2. **Ask Cursor to use the TTS tools**:

   ```
   Can you synthesize speech for "Hello, this is a test of the local voice MCP server"?
   ```

3. **Check TTS status**:

   ```
   What's the status of the TTS service?
   ```

4. **Test with options**:

   ```
   Synthesize "Welcome to the future of AI coding" with exaggeration set to 0.5
   ```

5. **Test audio playback**:

   ```
   Play the audio file that was just generated
   ```

6. **Test volume control**:
   ```
   Play the audio file at 25% volume
   ```

### 5. Verify the Tools Are Available

You should see the following tools available in Cursor:

- **`synthesize_text`** - For text-to-speech conversion
- **`play_audio`** - For playing audio files through system audio
- **`tts_status`** - For checking service status

### 6. Troubleshooting

If the MCP server doesn't appear in Cursor:

1. **Check the logs**: Look for error messages in Cursor's developer console
2. **Verify installation**: Run `local-voice-mcp-server` directly in terminal to ensure it works
3. **Check paths**: Ensure the command path is correct in your configuration
4. **Restart Cursor**: Sometimes a full restart is needed after configuration changes
5. **JSON parsing errors**: If you see "Unexpected token" errors, ensure you're using the latest version with proper stdio logging

### 7. Expected Behavior

When working correctly:

- Cursor will be able to call the TTS tools
- You'll receive structured JSON responses with file paths
- Audio files will be saved to the temporary directory
- The TTS service will use the Chatterbox TTS engine
- Files can be played using system audio players

All responses are in structured JSON format with clear file paths, making it easy for MCP clients and AI agents to understand and work with the results.

## Requirements

- Node.js 16+
- Python 3.8+
- PyTorch
- Chatterbox TTS

The service automatically sets up the Python environment and installs required dependencies on first run.

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   MCP Client    │    │  HTTP Client     │    │   CLI Tool      │
│ (Cursor, etc.)  │    │                  │    │                 │
└─────────┬───────┘    └─────────┬────────┘    └─────────┬───────┘
          │                      │                       │
          │ stdio                │ HTTP                  │ stdio
          │                      │                       │
          ▼                      ▼                       ▼
    ┌─────────────────────────────────────────────────────────────┐
    │              Local Voice MCP Server                         │
    │  ┌─────────────────┐    ┌─────────────────────────────────┐ │
    │  │   MCP Server    │    │         HTTP Server             │ │
    │  │   (stdio)       │    │      (Express.js)               │ │
    │  └─────────────────┘    └─────────────────────────────────┘ │
    │                                   │                         │
    │  ┌─────────────────────────────────────────────────────────┐ │
    │  │              TTS Tools & Services                       │ │
    │  │  ┌─────────────────┐    ┌─────────────────────────────┐ │ │
    │  │  │ ChatterboxService│    │    File Management         │ │ │
    │  │  │                 │    │   (Cleanup & Security)     │ │ │
    │  │  └─────────────────┘    └─────────────────────────────┘ │ │
    │  └─────────────────────────────────────────────────────────┘ │
    └─────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │   Python TTS        │
                        │  (Chatterbox)       │
                        └─────────────────────┘
```

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request
