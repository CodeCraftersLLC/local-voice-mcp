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

    // Check character limit to prevent creating wav files that are too large
    const maxCharacters = parseInt(
      process.env.CHATTERBOX_MAX_CHARACTERS || "2000",
      10
    );
    if (text.length > maxCharacters) {
      throw new Error(
        `Text exceeds maximum character limit of ${maxCharacters} characters. Current length: ${text.length}`
      );
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

    const pythonPath = path.join(this.venvPath, "bin", "python");

    const sanitizeTextArg = (val: any): string => {
      if (typeof val !== "string") {
        throw new Error("Text argument must be a string");
      }
      const strVal = String(val);
      if (strVal.length === 0) {
        throw new Error("Text cannot be empty");
      }
      if (strVal.length > 2000) {
        throw new Error("Text must be less than 2000 characters");
      }
      return strVal;
    };

    const sanitizeArg = (val: any, allowEmpty: boolean = false): string => {
      if (typeof val !== "string" && typeof val !== "number") {
        throw new Error("Argument must be a string or number");
      }
      const strVal = String(val);
      if (!allowEmpty && strVal.length === 0) {
        throw new Error("Argument cannot be empty");
      }
      if (strVal.length > 256) {
        throw new Error("Argument must be less than 256 characters");
      }
      // Allow empty strings when allowEmpty is true
      if (strVal.length === 0 && allowEmpty) {
        return strVal;
      }
      // Prevent argument injection via double dashes
      if (strVal.includes("--")) {
        throw new Error("Argument cannot contain double dashes");
      }
      // Strict validation to prevent command injection
      // Allow alphanumeric, spaces, safe punctuation, and forward slashes for file paths
      if (/^[a-zA-Z0-9 _\-.,=:\/]*$/.test(strVal)) {
        return strVal;
      } else {
        throw new Error("Invalid characters in argument");
      }
    };

    // Get values from environment variables, options, or defaults
    // Options take precedence over environment variables
    const referenceAudio =
      options?.referenceAudio || process.env.CHATTERBOX_REFERENCE_AUDIO || "";
    const exaggeration =
      options?.exaggeration ??
      (process.env.CHATTERBOX_EXAGGERATION
        ? parseFloat(process.env.CHATTERBOX_EXAGGERATION)
        : 0.2);
    const cfgWeight =
      options?.cfg_weight ??
      (process.env.CHATTERBOX_CFG_WEIGHT
        ? parseFloat(process.env.CHATTERBOX_CFG_WEIGHT)
        : 1.0);

    // Validate reference audio path if provided
    let validatedReferenceAudio = "";
    if (referenceAudio) {
      try {
        // For reference audio, we allow absolute paths but validate the file exists and is readable
        const resolvedPath = path.resolve(referenceAudio);

        // Check if file exists
        if (!fs.existsSync(resolvedPath)) {
          logger.warn(
            `Reference audio file does not exist: ${resolvedPath}. Using default voice instead.`
          );
          validatedReferenceAudio = "";
        } else {
          // Check if it's a file (not a directory)
          const stats = fs.statSync(resolvedPath);
          if (!stats.isFile()) {
            logger.warn(
              `Reference audio path is not a file: ${resolvedPath}. Using default voice instead.`
            );
            validatedReferenceAudio = "";
          } else {
            // Basic security check - ensure it's not trying to access system files
            // Allow common audio file extensions
            const ext = path.extname(resolvedPath).toLowerCase();
            const allowedExtensions = [
              ".wav",
              ".mp3",
              ".flac",
              ".ogg",
              ".m4a",
              ".aac",
            ];
            if (!allowedExtensions.includes(ext)) {
              logger.warn(
                `Unsupported audio file format: ${ext}. Supported formats: ${allowedExtensions.join(
                  ", "
                )}. Using default voice instead.`
              );
              validatedReferenceAudio = "";
            } else {
              validatedReferenceAudio = resolvedPath;
              logger.log(`Using reference audio file: ${resolvedPath}`);
            }
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        logger.warn(
          `Error validating reference audio path: ${message}. Using default voice instead.`
        );
        validatedReferenceAudio = "";
      }
    }

    const args = [
      this.scriptPath,
      `--text=${sanitizeTextArg(text)}`,
      `--output=${outputFile}`,
      `--reference_audio=${sanitizeArg(validatedReferenceAudio, true)}`, // Allow empty for optional parameter
      `--exaggeration=${sanitizeArg(exaggeration)}`,
      `--cfg_weight=${sanitizeArg(cfgWeight)}`,
    ];

    return new Promise((resolve, reject) => {
      logger.log("Starting TTS synthesis");
      logger.log("Python path:", pythonPath);
      logger.log("Script path:", this.scriptPath);
      logger.log("Arguments:", args);

      const process = spawn(pythonPath, args);
      logger.log("TTS process started. Waiting for completion...");

      let stderrData = "";
      let stdoutData = "";

      process.stderr.on("data", (data) => {
        const chunk = data.toString();
        stderrData += chunk;
        logger.log("TTS stderr:", chunk.trim());
      });

      process.stdout.on("data", (data) => {
        const chunk = data.toString();
        stdoutData += chunk;
        logger.log("TTS stdout:", chunk.trim());
      });

      const startTime = Date.now();

      process.on("close", (code) => {
        const duration = Date.now() - startTime;
        logger.log(`TTS process closed with code ${code} after ${duration}ms`);

        if (code === 0 && fs.existsSync(outputFile)) {
          logger.log(`TTS synthesis completed successfully in ${duration}ms`);
          logger.log("Output file exists:", outputFile);
          resolve(outputFile);
        } else {
          logger.error(
            `TTS synthesis failed after ${duration}ms with code ${code}`
          );
          logger.error("Error output (stderr):", stderrData);
          logger.error("Standard output (stdout):", stdoutData);
          logger.error("Output file exists:", fs.existsSync(outputFile));

          const errorMessage =
            stderrData.trim() ||
            stdoutData.trim() ||
            `Process exited with code ${code}`;
          reject(new Error(`TTS synthesis failed: ${errorMessage}`));
        }
      });

      process.on("error", (err) => {
        logger.error("TTS process error:", err);
        reject(new Error(`TTS process error: ${err.message}`));
      });
    });
  }
}
