import { spawn } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";
import { promisify } from "util";
import { logger } from "../utils/logger";

const exec = promisify(require("child_process").exec);

export class ChatterboxService {
  private venvPath: string;
  private scriptPath: string;
  private environmentSetupPromise: Promise<void>;

  constructor() {
    this.venvPath = path.join(os.homedir(), ".local-voice-mcp", "venv");
    this.scriptPath = path.join(
      __dirname,
      "..",
      "..",
      "scripts",
      "tts_runner.py"
    );
    this.environmentSetupPromise = this.setupEnvironment();
  }

  /**
   * Ensures the Python environment is ready before proceeding
   * @returns Promise that resolves when environment setup is complete
   */
  public async ensureReady(): Promise<void> {
    return this.environmentSetupPromise;
  }

  async setupEnvironment(): Promise<void> {
    try {
      // Create virtual environment if not exists
      if (!fs.existsSync(this.venvPath)) {
        logger.log(`Creating virtual environment at ${this.venvPath}...`);
        const { stdout, stderr } = await exec(
          `python3 -m venv ${this.venvPath}`
        );
        logger.log("Virtual environment created.");
        if (stdout) logger.log(stdout);
        if (stderr) logger.error(stderr);
      }

      // Install PyTorch and TTS package
      const pipPath = path.join(this.venvPath, "bin", "pip");
      logger.log("Installing PyTorch and TTS...");

      const commands = [
        `${pipPath} install torch torchaudio`,
        `${pipPath} install TTS`,
      ];

      for (const cmd of commands) {
        const { stdout, stderr } = await exec(cmd);
        if (stdout) logger.log(stdout);
        if (stderr) logger.error(stderr);
      }

      logger.log("TTS dependencies installed successfully.");

      // Verify installation
      logger.log("Verifying package installation...");
      const { stdout: listStdout, stderr: listStderr } = await exec(
        `${pipPath} list`
      );
      logger.log("Installed packages:", listStdout);
      if (listStderr) logger.error(listStderr);
    } catch (error) {
      logger.error("Error setting up environment");
      throw new Error("Environment setup failed");
    }
  }

  async synthesize(text: string, options: any): Promise<string> {
    // Validate input text
    if (!text || text.trim().length === 0) {
      throw new Error("Text parameter is required and cannot be empty");
    }

    try {
      await this.environmentSetupPromise;
    } catch (error) {
      logger.error("Environment setup failed");
      throw new Error("TTS environment not ready");
    }

    const outputDir = path.join(os.tmpdir(), "local-voice-mcp");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputFile = path.join(outputDir, `tts-${Date.now()}.wav`);

    // Validate paths to prevent directory traversal
    const validatePath = (filePath: string, baseDir: string) => {
      try {
        const resolved = path.resolve(baseDir, filePath);
        const realResolved = fs.realpathSync(resolved);
        const realBase = fs.realpathSync(baseDir);

        // Use both startswith and relative path checking for robust validation
        if (!realResolved.startsWith(realBase + path.sep)) {
          throw new Error(`Invalid path: ${filePath}`);
        }

        // Additional check using relative path
        const relativePath = path.relative(realBase, realResolved);
        if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
          throw new Error(`Invalid path: ${filePath}`);
        }

        return realResolved;
      } catch (error) {
        if (error instanceof Error && error.message.includes("Invalid path")) {
          throw error;
        }
        // If realpath fails (file doesn't exist), fall back to resolve-only validation
        const resolved = path.resolve(baseDir, filePath);
        const normalizedBase = path.resolve(baseDir) + path.sep;
        if (!resolved.startsWith(normalizedBase)) {
          throw new Error(`Invalid path: ${filePath}`);
        }
        return resolved;
      }
    };

    const pythonPath = path.join(this.venvPath, "bin", "python");
    const sanitizeArg = (val: any): string => {
      if (typeof val === "string") {
        // Strict validation to prevent command injection
        // Only allow alphanumeric, spaces, and safe punctuation
        if (/^[a-zA-Z0-9 _\-.,=:]*$/.test(val)) {
          return val;
        } else {
          throw new Error(`Invalid characters in argument: ${val}`);
        }
      }
      return String(val);
    };

    const args = [
      this.scriptPath,
      `--text=${sanitizeArg(text)}`,
      `--output=${outputFile}`,
      `--reference_audio=${sanitizeArg(options?.referenceAudio || "")}`,
      `--exaggeration=${sanitizeArg(options?.exaggeration || 0.2)}`,
      `--cfg_weight=${sanitizeArg(options?.cfg_weight || 1.0)}`,
    ];

    // Add reference audio if provided
    if (options?.referenceAudio) {
      try {
        const safePath = validatePath(options.referenceAudio, outputDir);
        args.push(`--reference_audio=${safePath}`);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        throw new Error(`Invalid reference audio path: ${message}`);
      }
    }

    return new Promise((resolve, reject) => {
      logger.log("Starting TTS synthesis");

      const process = spawn(pythonPath, args);
      logger.log("TTS process started. Waiting for completion...");

      let stderrData = "";
      process.stderr.on("data", (data) => {
        stderrData += data.toString();
      });

      const startTime = Date.now();

      process.on("close", (code) => {
        if (code === 0 && fs.existsSync(outputFile)) {
          const duration = Date.now() - startTime;
          logger.log(`TTS synthesis completed successfully in ${duration}ms`);
          resolve(outputFile);
        } else {
          const duration = Date.now() - startTime;
          logger.error(
            `TTS synthesis failed after ${duration}ms with code ${code}`
          );
          logger.error("Error output:", stderrData);
          reject(new Error(`TTS synthesis failed: ${stderrData}`));
        }
      });

      process.on("error", (err) => {
        logger.error("TTS process error");
        reject(new Error("TTS process error"));
      });
    });
  }
}
