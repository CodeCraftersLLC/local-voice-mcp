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

    if (!text || text.trim().length === 0) {
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

      // Security: Ensure the file is within allowed directories
      const resolvedPath = path.resolve(audioFile);
      const tempDir = path.resolve(TEMP_AUDIO_DIR);
      const homeDir = path.resolve(os.homedir());

      if (
        !resolvedPath.startsWith(tempDir) &&
        !resolvedPath.startsWith(homeDir)
      ) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: false,
                  error: "Access denied",
                  message:
                    "Audio file must be in temp directory or user home directory",
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
        // Windows
        command = "powershell";
        args = [
          "-c",
          `(New-Object Media.SoundPlayer '${audioFile}').PlaySync()`,
        ];
      } else {
        // Linux
        command = "aplay";
        args = [audioFile];
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

// Schema definitions for MCP tools
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
