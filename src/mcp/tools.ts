import { z } from "zod";
import { ChatterboxService } from "../core/chatterbox.service";
import fs from "fs";
import path from "path";
import os from "os";
import { logger } from "../utils/logger";

const TEMP_AUDIO_DIR = path.join(os.tmpdir(), "local-voice-mcp");

// Create temp directory if it doesn't exist
if (!fs.existsSync(TEMP_AUDIO_DIR)) {
  fs.mkdirSync(TEMP_AUDIO_DIR, { recursive: true });
}

/**
 * TTS Tool Implementation for MCP
 */
export class TTSTools {
  private chatterbox: ChatterboxService;

  constructor() {
    this.chatterbox = new ChatterboxService();
  }

  /**
   * Ensure the TTS service is ready
   */
  async ensureReady(): Promise<void> {
    await this.chatterbox.ensureReady();
  }

  /**
   * Text-to-Speech synthesis tool
   * Converts text to speech and returns the audio file path
   */
  async synthesizeText(params: {
    text: string;
    referenceAudio?: string;
    exaggeration?: number;
    cfg_weight?: number;
  }) {
    const {
      text,
      referenceAudio,
      exaggeration = 0.2,
      cfg_weight = 1.0,
    } = params;

    // Validate referenceAudio parameter if provided
    if (referenceAudio && !/^[\w\-.\\/\\]+$/.test(referenceAudio)) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: false,
                error: "Invalid input",
                message: "Reference audio path contains invalid characters",
                timestamp: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: false,
                error: "Invalid input",
                message: "Text parameter is required and cannot be empty",
                timestamp: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    // Check character limit to prevent creating wav files that are too large
    const maxCharacters = parseInt(
      process.env.CHATTERBOX_MAX_CHARACTERS || "2000",
      10
    );
    if (text && text.length > maxCharacters) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: false,
                error: "Text too long",
                message: `Text exceeds maximum character limit of ${maxCharacters} characters. Current length: ${text.length}`,
                maxCharacters,
                currentLength: text.length,
                timestamp: new Date().toISOString(),
                // Sanitize text to prevent log injection or information disclosure
                sanitizedInput:
                  typeof text === "string"
                    ? text.replace(/[\r\n\t]/g, " ").substring(0, 100)
                    : "",
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    try {
      const audioPath = await this.chatterbox.synthesize(text, {
        referenceAudio,
        exaggeration,
        cfg_weight,
      });

      // Validate audio path is within TEMP_AUDIO_DIR (security check)
      const resolvedPath = path.resolve(audioPath);
      const normalizedTempDir = path.normalize(TEMP_AUDIO_DIR) + path.sep;
      if (!resolvedPath.startsWith(normalizedTempDir)) {
        throw new Error("Invalid audio path generated");
      }

      // Keep the file in place for the user to access
      // Note: Avoid console.log in MCP mode as it interferes with stdio communication

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                message: "Speech synthesis completed successfully",
                audioFile: audioPath,
                textLength: text.length,
                audioFormat: "wav",
                options: {
                  exaggeration,
                  cfg_weight,
                },
                generatedAt: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      // Use logger which handles MCP stdio communication properly
      logger.error("TTS synthesis error:", error);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: false,
                error: "TTS synthesis failed",
                message:
                  error instanceof Error ? error.message : "Unknown error",
                timestamp: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Get TTS service status
   */
  async getStatus() {
    try {
      await this.chatterbox.ensureReady();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                status: "operational",
                message: "TTS service is ready and operational",
                timestamp: new Date().toISOString(),
                service: {
                  name: "Chatterbox TTS",
                  version: "0.1.0",
                  capabilities: [
                    "text-to-speech synthesis",
                    "voice cloning with reference audio",
                    "prosody controls",
                  ],
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: false,
                status: "error",
                message: "TTS service is not ready",
                error: error instanceof Error ? error.message : "Unknown error",
                timestamp: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Play an audio file using the system's default audio player
   */
  async playAudio(params: { audioFile: string }): Promise<{
    content: Array<{
      type: "text";
      text: string;
    }>;
    isError?: boolean;
  }> {
    const { audioFile } = params;

    // Validate input
    if (!audioFile || audioFile.trim().length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: false,
                error: "Invalid input",
                message: "Audio file path is required and cannot be empty",
                timestamp: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    try {
      // Validate file exists and is accessible
      if (!fs.existsSync(audioFile)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: false,
                  error: "File not found",
                  message: `Audio file does not exist: ${audioFile}`,
                  timestamp: new Date().toISOString(),
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      // Validate file extension (support WAV and MP3)
      const ext = path.extname(audioFile).toLowerCase();
      if (![".wav", ".mp3"].includes(ext)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: false,
                  error: "Unsupported format",
                  message: `Unsupported audio format: ${ext}. Supported formats: .wav, .mp3`,
                  timestamp: new Date().toISOString(),
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      // Security: Ensure the file is within temp directory only (principle of least privilege)
      const resolvedPath = path.resolve(audioFile);
      const tempDir = path.resolve(TEMP_AUDIO_DIR);

      if (!resolvedPath.startsWith(tempDir + path.sep)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: false,
                  error: "Access denied",
                  message:
                    "Audio file must be in the temporary directory for security reasons",
                  allowedDirectory: TEMP_AUDIO_DIR,
                  timestamp: new Date().toISOString(),
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      // Play the audio file using system command
      const { spawn } = require("child_process");
      let command: string;
      let args: string[];

      // Determine the appropriate command based on the platform
      if (process.platform === "darwin") {
        // macOS
        command = "afplay";
        args = [audioFile];
      } else if (process.platform === "win32") {
        // Windows - sanitize audioFile to prevent command injection
        // Preserve backslashes for Windows paths but remove other dangerous characters
        const sanitizedAudioFile = audioFile.replace(/[`'"\n\r]/g, "");
        command = "powershell";
        args = [
          "-c",
          `Add-Type -AssemblyName presentationcore; $player = New-Object System.Windows.Media.MediaPlayer; $player.Open([Uri]::new("${sanitizedAudioFile}")); $player.Play(); Start-Sleep -Seconds 5;`,
        ];
      } else {
        // Linux
        const ext = path.extname(audioFile).toLowerCase();
        const safeAudioFile = path.basename(audioFile).replace(/[`'"\\$]/g, "");
        if (ext === ".mp3") {
          command = "mpg123";
          args = [safeAudioFile];
        } else {
          command = "aplay";
          args = [safeAudioFile];
        }
      }

      return new Promise((resolve) => {
        const player = spawn(command, args);

        player.on("close", (code: number) => {
          if (code === 0) {
            resolve({
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      message: `Successfully played audio file: ${audioFile}`,
                      audioFile: audioFile,
                      platform: process.platform,
                      command: `${command} ${args.join(" ")}`,
                      timestamp: new Date().toISOString(),
                    },
                    null,
                    2
                  ),
                },
              ],
            });
          } else {
            resolve({
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: false,
                      error: "Playback failed",
                      message: `Audio playback failed with exit code: ${code}`,
                      audioFile: audioFile,
                      platform: process.platform,
                      command: `${command} ${args.join(" ")}`,
                      timestamp: new Date().toISOString(),
                    },
                    null,
                    2
                  ),
                },
              ],
              isError: true,
            });
          }
        });

        player.on("error", (err: Error) => {
          resolve({
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: false,
                    error: "Command failed",
                    message: `Failed to execute audio player: ${err.message}`,
                    audioFile: audioFile,
                    platform: process.platform,
                    command: `${command} ${args.join(" ")}`,
                    timestamp: new Date().toISOString(),
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          });
        });
      });
    } catch (error) {
      logger.error("Audio playback error:", error);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: false,
                error: "Playback error",
                message:
                  error instanceof Error ? error.message : "Unknown error",
                timestamp: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
}

/**
 * Execute tool and handle errors
 * @param toolName - Name of the tool to execute
 * @param args - Arguments for the tool
 * @param ttsTools - TTSTools instance
 * @returns Tool execution result
 */
export async function executeToolAndHandleErrors(
  toolName: string,
  args: any,
  ttsTools: TTSTools
): Promise<any> {
  try {
    switch (toolName) {
      case "synthesize_text":
        return await ttsTools.synthesizeText(args);
      case "play_audio":
        return await ttsTools.playAudio(args);
      case "tts_status":
        return await ttsTools.getStatus();
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    // Return error in the expected format
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: false,
              error: "Tool execution failed",
              message: error instanceof Error ? error.message : "Unknown error",
              tool: toolName,
              timestamp: new Date().toISOString(),
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
}

// Tool type definition
export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Synthesize Text Tool
 * @param {object} args - A JSON object containing the arguments
 * @see {synthesizeTextToolExecutor}
 */
const synthesizeTextTool: Tool = {
  name: "synthesize_text",
  description:
    "Convert text to speech with optional voice cloning using reference audio. Supports prosody controls for exaggeration and configuration weight.",
  inputSchema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description:
          "The text to convert to speech. Must be non-empty and under the character limit.",
      },
      referenceAudio: {
        type: "string",
        description: "Optional path to reference audio file for voice cloning.",
      },
      exaggeration: {
        type: "number",
        description:
          "Voice style exaggeration level (0.0 to 2.0, default: 0.2).",
        minimum: 0,
        maximum: 2,
      },
      cfg_weight: {
        type: "number",
        description:
          "Configuration weight for TTS model (0.0 to 5.0, default: 1.0).",
        minimum: 0,
        maximum: 5,
      },
    },
    required: ["text"],
  },
};

/**
 * Play Audio Tool
 * @param {object} args - A JSON object containing the arguments
 * @see {playAudioToolExecutor}
 */
const playAudioTool: Tool = {
  name: "play_audio",
  description:
    "Play an audio file using the system's default audio player. Supports WAV and MP3 formats. Files must be in the temporary directory for security.",
  inputSchema: {
    type: "object",
    properties: {
      audioFile: {
        type: "string",
        description:
          "Path to the audio file to play. Must be a .wav or .mp3 file in the temporary directory.",
      },
    },
    required: ["audioFile"],
  },
};

/**
 * TTS Status Tool
 * @param {object} args - A JSON object containing the arguments
 * @see {ttsStatusToolExecutor}
 */
const ttsStatusTool: Tool = {
  name: "tts_status",
  description:
    "Get the current status of the TTS service, including operational state and capabilities.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
};

// Export all tools as an array
export const ALL_TOOLS: Tool[] = [
  synthesizeTextTool,
  playAudioTool,
  ttsStatusTool,
];

// Schema definitions for validation (keeping for backward compatibility)
export const TTSToolSchemas = {
  synthesizeText: {
    text: z.string().min(1, "Text cannot be empty"),
    referenceAudio: z.string().optional(),
    exaggeration: z.number().min(0).max(2).optional(),
    cfg_weight: z.number().min(0).max(5).optional(),
  },
  playAudio: {
    audioFile: z.string().min(1, "Audio file path cannot be empty"),
  },
  getStatus: {},
};
