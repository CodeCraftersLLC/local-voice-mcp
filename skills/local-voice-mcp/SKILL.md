---
name: local-voice-mcp
description: >-
  Speak aloud, synthesize local text-to-speech audio, and manage Quiet Mode or
  playback settings using the local-voice-mcp MCP server and tray controller.
  Use when the user asks you to speak, read something aloud, announce task
  completion by voice, synthesize WAV speech locally (Chatterbox Turbo or
  Kokoro), configure voice/volume, or toggle Quiet Mode.
---

# Local Voice MCP

Give AI coding agents local text-to-speech playback via the `local-voice-mcp` MCP server (Chatterbox Turbo TTS or Kokoro TTS), with cross-platform Quiet Mode and system tray controls (`local-voice-mcp-tray`).

## MCP Tools

The `local-voice-mcp` server exposes three tools:

| Tool | Purpose |
| :--- | :--- |
| `synthesize_text` | Converts text to a `.wav` file in the OS temp directory (`<tmpdir>/local-voice-mcp/`) and returns `audioFile`. |
| `play_audio` | Plays a `.wav` or `.mp3` file from the temp directory, respecting Quiet Mode, temporary snooze, macOS mute, and user volume settings. Deletes the temp file after playback by default. |
| `tts_status` | Checks engine readiness, active TTS engine, Quiet Mode status, configured volume, and config file path. |

## Standard Speaking Workflow

To speak a message to the user:

1. **Write for speech, not markdown.** Strip code blocks, raw file paths, URLs, backticks, and markdown tables. Keep announcements concise and natural.
2. **Synthesize speech** with `synthesize_text`:
   - **Chatterbox Turbo (default):** Pass `text` (and optionally `referenceAudio` for voice cloning). Supports expressive paralinguistic tags directly in text: `[laugh]`, `[sigh]`, `[cough]`, `[chuckle]`, `[gasp]`, `[groan]`, `[clear throat]`, `[sniff]`, `[shush]`.
   - **Kokoro:** Pass `text` plus optional `voice` (e.g., `af_sarah`, `am_adam`, `bf_emma`, or blends like `af_sarah:60,am_adam:40`), `speed` (`0.5`–`2.0`), and `language` (`en-us`, `en-gb`, `fr-fr`, `it`, `ja`, `cmn`).
3. **Play the generated file** with `play_audio`:
   - Pass `audioFile` returned by `synthesize_text`.
   - **Omit `volume`** unless the user explicitly asked for a specific volume so the server respects the user's tray/config (`~/.local-voice-mcp/config.json`) or `CHATTERBOX_PLAYBACK_VOLUME` setting.
   - Leave `deleteAfterPlay` unset (defaults to `true`) unless the user explicitly wants to keep the generated `.wav` file.
4. **Handle Quiet Mode / Mute gracefully:**
   - If `play_audio` returns `"skipped": true` (with `"quietMode": true` or `"muted": true`), playback was intentionally suppressed by the user. Treat this as a success — do **not** retry playback or report an error.

## Quiet Mode, Tray App & Shared Config

Both the MCP server and the cross-platform tray utility (`local-voice-mcp-tray`, supporting macOS, Windows, and Linux/Ubuntu) share `~/.local-voice-mcp/config.json` (overrideable via `LOCAL_VOICE_MCP_CONFIG`):

```json
{
  "quietMode": false,
  "quietUntil": null,
  "volume": 75,
  "useMaleVoice": null
}
```

### Volume Resolution Priority

1. Explicit `volume` argument passed to `play_audio`
2. `volume` in `~/.local-voice-mcp/config.json` (set via tray menu or CLI)
3. `CHATTERBOX_PLAYBACK_VOLUME` environment variable
4. Default (`50`)

### Tray & CLI Commands

```bash
# Start menu bar / system tray icon in the background
# (auto-installs pystray and Pillow on first run)
local-voice-mcp-tray --background

# Inspect current Quiet Mode, snooze, volume, and tray PID
local-voice-mcp-tray --status

# Toggle Quiet Mode or volume from the terminal
local-voice-mcp-tray --quiet on
local-voice-mcp-tray --quiet off
local-voice-mcp-tray --volume 75
local-voice-mcp-tray --volume default

# Stop a running background tray process
local-voice-mcp-tray --stop
```

From the tray menu, users can toggle **Quiet Mode**, **Disable Temporarily** (15m / 30m / 1h / 2h), change **Playback Volume** (25%–100% or default), switch **Chatterbox Voice** (Female / Male / Default), or open `config.json`.

## MCP Client Configuration

### Global Install (Recommended for Local Tray + MCP)

```bash
npm install -g @codecraftersllc/local-voice-mcp
```

### Chatterbox Turbo (Apple Silicon / CUDA / CPU)

```json
{
  "mcpServers": {
    "local-voice-mcp": {
      "command": "local-voice-mcp-server",
      "args": [],
      "env": {
        "TTS_ENGINE": "chatterbox",
        "PYTHON_PATH": "/path/to/chatterbox-env/bin/python",
        "TRAY_PYTHON_PATH": "/path/to/python3",
        "ENABLE_TRAY": "true"
      }
    }
  }
}
```

*(Note: On Apple Silicon, `mlx-audio` requires Python 3.10–3.12 via `PYTHON_PATH`. Set `TRAY_PYTHON_PATH` if `pystray`/`Pillow` live in a different Python environment than Chatterbox.)*

### Kokoro TTS (Zero-Config Cross-Platform)

```json
{
  "mcpServers": {
    "local-voice-mcp": {
      "command": "npx",
      "args": ["-y", "@codecraftersllc/local-voice-mcp"],
      "env": {
        "TTS_ENGINE": "kokoro",
        "KOKORO_VOICE": "af_sarah",
        "ENABLE_TRAY": "true"
      }
    }
  }
}
```

## Troubleshooting

- **Check readiness and Quiet Mode:** Call `tts_status` to verify the active engine and see whether `playback.quietMode` is active.
- **No sound played:** Check whether `play_audio` returned `"skipped": true` (Quiet Mode, active `quietUntil` snooze, or macOS system mute).
- **Audio player missing:** `play_audio` prefers `ffplay` (from `ffmpeg`) for consistent cross-platform volume control, falling back to `afplay` (macOS), PowerShell `MediaPlayer` (Windows), or `mpg123`/`aplay` (Linux).
- **Text limit exceeded:** Chatterbox defaults to `CHATTERBOX_MAX_CHARACTERS=2000` (Kokoro `5000`). Split long passages into shorter chunks before synthesizing.
