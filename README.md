# Local Voice MCP

Give your MCP clients the ability to speak by running local voice models using Chatterbox TTS.

## Quickstart

```json
{
  "mcpServers": {
    "local-voice-mcp": {
      "command": "npx",
      "args": ["-y", "@codecraftersllc/local-voice-mcp"],
      "env": {
        "CHATTERBOX_REFERENCE_AUDIO": "/TODO",
        "CHATTERBOX_EXAGGERATION": "0.5",
        "CHATTERBOX_CFG_WEIGHT": "1.2",
        "CHATTERBOX_MAX_CHARACTERS": "2000"
      }
    }
  }
}
```

## Features

- **MCP Server Implementation**: Full Model Context Protocol server using `@modelcontextprotocol/sdk`
- **HTTP API**: ElevenLabs-compatible REST API for direct integration
- **Text-to-Speech Synthesis**: High-quality voice synthesis using Chatterbox TTS
- **Voice Cloning**: Support for reference audio for voice cloning
- **Prosody Controls**: Adjustable exaggeration and configuration weights
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

Converts text to speech and returns audio data.

**Parameters:**

- `text` (string, required): Text to synthesize
- `referenceAudio` (string, optional): Path to reference audio for voice cloning
- `exaggeration` (number, optional): Voice style exaggeration (0-2, default: 0.2)
- `cfg_weight` (number, optional): Configuration weight (0-5, default: 1.0)

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
  "options": {
    "exaggeration": 0.2,
    "cfg_weight": 1.0
  },
  "generatedAt": "2024-01-15T10:30:00.000Z"
}
```

The audio file is saved to the temporary directory and can be played using any audio player or accessed programmatically.

### `play_audio`

Play an audio file using the system's default audio player.

**Parameters:**

- `audioFile` (string, required): Path to the audio file to play

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
  "platform": "darwin",
  "command": "afplay /tmp/local-voice-mcp/audio_123.wav",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Platform Support:**

- **macOS**: Uses `afplay` command
- **Windows**: Uses PowerShell with `Media.SoundPlayer`
- **Linux**: Uses `aplay` command

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

#### TTS Configuration

These environment variables can be used to set default values for TTS synthesis. They will be used if not overridden by options passed to the synthesize method:

- `CHATTERBOX_REFERENCE_AUDIO`: Path to reference audio file for voice cloning (default: empty)
- `CHATTERBOX_EXAGGERATION`: Voice style exaggeration level (float, default: 0.2)
- `CHATTERBOX_CFG_WEIGHT`: Configuration weight for TTS model (float, default: 1.0)
- `CHATTERBOX_MAX_CHARACTERS`: Maximum number of characters allowed for text input (integer, default: 2000)

**Example:**

```bash
# Set default TTS parameters via environment variables
export CHATTERBOX_REFERENCE_AUDIO="./node_modules/@codecraftersllc/local-voice-mcp/female-reference-voice.wav"
export CHATTERBOX_EXAGGERATION="0.5"
export CHATTERBOX_CFG_WEIGHT="1.2"
export CHATTERBOX_MAX_CHARACTERS="3000"

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
        "CHATTERBOX_REFERENCE_AUDIO": "./node_modules/@codecraftersllc/local-voice-mcp/female-reference-voice.wav",
        "CHATTERBOX_EXAGGERATION": "0.5",
        "CHATTERBOX_CFG_WEIGHT": "1.2",
        "CHATTERBOX_MAX_CHARACTERS": "3000"
      }
    }
  }
}
```

**Priority Order:**

1. Options passed to the `synthesize_text` tool (highest priority)
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
