import express, { Request, Response, NextFunction } from "express";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import os from "os";
import { finished } from "stream";
import { ChatterboxService } from "./core/chatterbox.service";
import { logger } from "./utils/logger";

interface TTSRequest {
  text: string;
  options?: {
    referenceAudio?: string;
    exaggeration?: number;
    cfg_weight?: number;
  };
}

const app = express();
const port = 59125;
const chatterbox = new ChatterboxService();
const TEMP_AUDIO_DIR = path.join(os.tmpdir(), "local-voice-mcp");

// Create temp directory if it doesn't exist
if (!fs.existsSync(TEMP_AUDIO_DIR)) {
  fs.mkdirSync(TEMP_AUDIO_DIR, { recursive: true });
}

app.use(bodyParser.json());

// Authentication middleware placeholder
const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey) {
    res.status(401).json({ error: "API key required" });
    return;
  }

  // In a real implementation, validate against database or environment variable
  // For now, we'll just log and proceed as a placeholder
  console.log(`Authentication placeholder: API key ${apiKey} received`);
  next();
};

async function ttsHandler(req: Request<{}, {}, TTSRequest>, res: Response) {
  let audioPath: string | undefined;

  try {
    const { text, options = {} } = req.body;

    if (!text) {
      res.status(400).json({ error: "Text parameter is required" });
      return;
    }

    // Check character limit to prevent creating wav files that are too large
    const maxCharacters = parseInt(
      process.env.CHATTERBOX_MAX_CHARACTERS || "2000",
      10
    );
    if (text.length > maxCharacters) {
      res.status(400).json({
        error: "Text too long",
        message: `Text exceeds maximum character limit of ${maxCharacters} characters. Current length: ${text.length}`,
        maxCharacters,
        currentLength: text.length,
      });
      return;
    }

    // This call might throw, or return a path
    audioPath = await chatterbox.synthesize(text, options);

    // Validate audioPath is within TEMP_AUDIO_DIR (critical)
    const resolvedPath = path.resolve(audioPath);
    const normalizedTempDir = path.normalize(TEMP_AUDIO_DIR) + path.sep;
    if (!resolvedPath.startsWith(normalizedTempDir)) {
      console.error(
        `Security Alert: Attempt to access file outside temp dir: ${resolvedPath}`
      );
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
          console.error("Stream finished with error:", err);
          rejectPromise(err); // This error will be caught by the outer catch
        } else {
          resolvePromise();
        }
      });
      audioStream.on("error", (err) => {
        console.error("Audio stream error:", err);
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
    console.error("Error in ttsHandler:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "TTS processing failed" });
    }
  } finally {
    if (audioPath && fs.existsSync(audioPath)) {
      // Double-check path again before unlinking, though initial validation should suffice
      const resolvedPathFinal = path.resolve(audioPath);
      const normalizedTempDirFinal = path.normalize(TEMP_AUDIO_DIR) + path.sep;
      if (resolvedPathFinal.startsWith(normalizedTempDirFinal)) {
        fs.unlink(audioPath, (unlinkErr) => {
          if (unlinkErr) {
            console.error(`Error deleting temp file ${audioPath}:`, unlinkErr);
          } else {
            console.log(`Successfully deleted temp file: ${audioPath}`);
          }
        });
      } else {
        console.error(
          `Security Alert: Skipped deletion of suspicious path in finally block: ${audioPath}`
        );
      }
    }
  }
}

app.post("/tts", authenticate, ttsHandler);

export async function startApp(port: number): Promise<void> {
  try {
    await chatterbox.ensureReady(); // Wait for Python env
    logger.log("Chatterbox environment successfully initialized.");
  } catch (error) {
    logger.error("Failed to initialize Chatterbox environment:", error);
    throw error; // Prevent server from starting if env setup fails
  }

  return new Promise((resolve, reject) => {
    const serverInstance = app.listen(port, () => {
      logger.log(`Local Voice MCP server running at http://localhost:${port}`);
      resolve();
    });
    serverInstance.on("error", (err) => {
      logger.error(`Server failed to start on port ${port}:`, err);
      reject(err);
    });
  });
}

// For direct execution (e.g., ts-node src/server.ts)
if (require.main === module) {
  const defaultPort = parseInt(process.env.PORT || "59125", 10);
  startApp(defaultPort).catch((error) => {
    logger.error("Failed to start application directly:", error);
    process.exit(1);
  });
}
