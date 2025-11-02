import express, { Request, Response, NextFunction } from "express";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import os from "os";
import { finished } from "stream";
import { TTSService } from "./core/tts-service.factory";
import { logger } from "./utils/logger";
import crypto from "crypto";

interface TTSRequest {
  text: string;
  options?: {
    referenceAudio?: string;
    exaggeration?: number;
    cfg_weight?: number;
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    chunk_size?: number;
    lookback_frames?: number;
    repetition_penalty?: number;
    repetition_context_size?: number;
  };
}

const app = express();
const ttsService = new TTSService();
const TEMP_AUDIO_DIR = path.join(os.tmpdir(), "local-voice-mcp");

// Create temp directory if it doesn't exist
if (!fs.existsSync(TEMP_AUDIO_DIR)) {
  fs.mkdirSync(TEMP_AUDIO_DIR, { recursive: true });
}

app.use(bodyParser.json());

// Authentication middleware
const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey) {
    res.status(401).json({ error: "API key required" });
    return;
  }

  // Handle case where multiple API keys are provided
  if (Array.isArray(apiKey)) {
    res.status(400).json({ error: "Multiple API keys provided" });
    return;
  }

  // Validate API key against environment variable
  // Validate API key using timing-safe comparison
  const validApiKey = process.env.API_KEY;
  if (!validApiKey) {
    logger.error("API_KEY environment variable not set");
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  // Convert to buffers for secure comparison
  const apiKeyBuffer = Buffer.from(apiKey, 'utf8');
  const validKeyBuffer = Buffer.from(validApiKey, 'utf8');

  // Zero-pad shorter buffer so both have equal length
  const maxLen = Math.max(apiKeyBuffer.length, validKeyBuffer.length);
  const a = Buffer.concat([apiKeyBuffer, Buffer.alloc(maxLen - apiKeyBuffer.length)]);
  const b = Buffer.concat([validKeyBuffer, Buffer.alloc(maxLen - validKeyBuffer.length)]);

  if (!crypto.timingSafeEqual(a, b)) {
    logger.warn("Invalid API key attempt (content mismatch)");
    res.status(403).json({ error: "Access denied" });
    return;
  }

  logger.log("API key validated securely");
  next();
};

export { authenticate };

async function ttsHandler(req: Request<{}, {}, TTSRequest>, res: Response) {
  let audioPath: string | undefined;

  try {
    const { text, options = {} } = req.body;

    // Validate and sanitize input
    if (typeof text !== "string" || !text.trim() || text.length > 10000) {
      res.status(400).json({
        error:
          "Text parameter is required and must be a non-empty string under 10,000 characters.",
      });
      return;
    }
    if (typeof options !== "object" || Array.isArray(options)) {
      res.status(400).json({ error: "Options parameter must be an object." });
      return;
    }

    // Sanitize text input: remove control characters and trim
    const sanitizedText = text
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      .trim();

    // Check character limit to prevent creating wav files that are too large
    const maxCharacters = parseInt(
      process.env.CHATTERBOX_MAX_CHARACTERS || "2000",
      10
    );
    if (sanitizedText.length > maxCharacters) {
      res.status(400).json({
        error: "Text too long",
        message: `Text exceeds maximum character limit of ${maxCharacters} characters. Current length: ${sanitizedText.length}`,
        maxCharacters,
        currentLength: sanitizedText.length,
      });
      return;
    }

    // This call might throw, or return a path
    audioPath = await ttsService.synthesize(sanitizedText, options);
    
    if (!audioPath) {
      throw new Error("Synthesis returned no audio file path");
    }

    // Validate audioPath is within TEMP_AUDIO_DIR (critical)
    const resolvedPath = path.resolve(audioPath);
    const normalizedTempDir = path.normalize(TEMP_AUDIO_DIR) + path.sep;
    if (!resolvedPath.startsWith(normalizedTempDir)) {
      logger.error("Security Alert: Attempt to access file outside temp dir.");
      // Do not proceed with this path, do not attempt to delete it if it's outside temp.
      // audioPath should be considered invalid. For safety, set it to undefined.
      audioPath = undefined;
      throw new Error("Invalid audio path generated.");
    }

    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Disposition", "attachment; filename=tts.wav");

    const audioStream = fs.createReadStream(audioPath);

    // Return a promise that resolves/rejects based on stream events
    await new Promise<void>((resolvePromise, rejectPromise) => {
      audioStream.pipe(res);
      finished(audioStream, (err) => {
        if (err) {
          logger.error("Stream finished with error:", err);
          rejectPromise(err); // This error will be caught by the outer catch
        } else {
          resolvePromise();
        }
      });
      audioStream.on("error", (err) => {
        logger.error("Audio stream error:", err);
        // Ensure response isn't sent twice
        if (!res.headersSent) {
          // res.status(500).json({ error: 'Audio streaming failed' }); // Avoid, let outer catch handle
        } else {
          res.end();
        }
        rejectPromise(err); // This error will be caught by the outer catch
      });
    });
  } catch (error) {
    logger.error("Error in ttsHandler:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "TTS processing failed" });
    }
  } finally {
    if (
      typeof audioPath === "string" &&
      audioPath &&
      fs.existsSync(audioPath)
    ) {
      // Double-check path again before unlinking, though initial validation should suffice
      const resolvedPathFinal = path.resolve(audioPath);
      const normalizedTempDirFinal = path.normalize(TEMP_AUDIO_DIR) + path.sep;
      if (resolvedPathFinal.startsWith(normalizedTempDirFinal)) {
        fs.unlink(audioPath, (unlinkErr) => {
          if (unlinkErr) {
            logger.error("Error deleting temp file:", unlinkErr.message);
          } else {
            logger.log("Successfully deleted temp file");
          }
        });
      } else {
        logger.error(
          "Security Alert: Skipped deletion of suspicious path in finally block."
        );
      }
    }
  }
}

app.post("/tts", authenticate, ttsHandler);

export async function startApp(port: number): Promise<void> {
  try {
    await ttsService.ensureReady(); // Wait for TTS engine initialization
    logger.log(`TTS service (${ttsService.getEngineType()}) successfully initialized.`);
  } catch (error) {
    logger.error(
      `Failed to initialize TTS service (${ttsService.getEngineType()}):`,
      error instanceof Error ? error.message : "Unknown error"
    );
    throw error; // Prevent server from starting if env setup fails
  }

  return new Promise((resolve, reject) => {
    const serverInstance = app.listen(port, () => {
      logger.log(`Local Voice MCP server running at http://localhost:${port}`);
      resolve();
    });
    serverInstance.on("error", (err) => {
      if ((err as any).code === 'EADDRINUSE') {
        logger.error(`Port ${port} is already in use. Please choose a different port.`);
      } else {
        logger.error("Server failed to start:", err.message);
      }
      reject(err);
    });
  });
}

// For direct execution (e.g., ts-node src/server.ts)
if (require.main === module) {
  import("get-port")
    .then(async ({ default: getPort }) => {
      try {
        const envPort = process.env.PORT;
        let port: number;

        if (envPort) {
          port = Number.parseInt(envPort, 10);
          if (isNaN(port) || port < 1 || port > 65535) {
            throw new Error(`Invalid PORT environment variable: ${envPort}`);
          }
        } else {
          // No environment variable set, find an available port starting from 59125
          port = await getPort({ port: 59125 });
        }

        await startApp(port);
      } catch (error) {
        logger.error(
          "Failed to start application directly:",
          error instanceof Error ? error.message : "Unknown error"
        );
        process.exit(1);
      }
    })
    .catch((error) => {
      logger.error(
        "Failed to import get-port:",
        error instanceof Error ? error.message : "Unknown error"
      );
      process.exit(1);
    });
}
