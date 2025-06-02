import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { logger } from "../utils/logger";

export class ChatterboxService {
  private pythonPath: string;
  private scriptPath: string;
  private envReady: boolean = false;

  constructor() {
    this.pythonPath = this.resolvePythonPath();
    this.scriptPath = path.join(__dirname, "../../scripts/tts_runner.py");
  }

  private resolvePythonPath(): string {
    // Implementation remains the same
    return "python3";
  }

  async ensureReady(): Promise<void> {
    // Implementation remains the same
    return Promise.resolve();
  }

  /**
   * Sanitize non-file arguments (removes slashes)
   * Public for testing purposes
   */
  public sanitizeArg(val: any, allowEmpty: boolean = false): string {
    if (typeof val !== "string" && typeof val !== "number") {
      throw new Error("Argument must be a string or number");
    }
    const strVal = String(val);
    if (!allowEmpty && strVal.length === 0) {
      throw new Error("Argument cannot be empty");
    }
    if (strVal.length === 0 && allowEmpty) {
      return strVal;
    }
    if (strVal.includes("--")) {
      throw new Error("Argument cannot contain double dashes");
    }
    if (strVal.includes("/") || strVal.includes("\\")) {
      throw new Error("Argument cannot contain slashes");
    }
    // Allow common punctuation for TTS: letters, numbers, spaces, and common punctuation
    // Includes: ! ? . , ; : ' " ( ) [ ] { } - _ = + @ # $ % & * ~ ` ^ | < >
    if (/^[a-zA-Z0-9 _\-.,=:!?;'"()\[\]{}+@#$%&*~`^|<>]*$/.test(strVal)) {
      return strVal;
    } else {
      throw new Error("Invalid characters in argument");
    }
  }

  /**
   * Validate audio file path with security checks (restrictive - for temp files only)
   * Public for testing purposes
   */
  public validateAudioPath(filePath: string): string {
    const resolvedPath = path.resolve(filePath);
    const normalizedPath = path.normalize(resolvedPath);

    if (normalizedPath.includes("..")) {
      throw new Error(`Path traversal detected: ${filePath}`);
    }

    // Restrict to temporary directory only
    const tempDir = path.resolve(os.tmpdir());
    if (
      !normalizedPath.startsWith(tempDir + path.sep) &&
      normalizedPath !== tempDir
    ) {
      throw new Error(
        `Access restricted to temporary directory only: ${tempDir}`
      );
    }

    if (!fs.existsSync(normalizedPath)) {
      throw new Error(`File not found: ${normalizedPath}`);
    }

    const stats = fs.statSync(normalizedPath);
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${normalizedPath}`);
    }

    const ext = path.extname(normalizedPath).toLowerCase();
    const allowedExtensions = [".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"];
    if (!allowedExtensions.includes(ext)) {
      throw new Error(
        `Unsupported audio format: ${ext}. Allowed: ${allowedExtensions.join(", ")}`
      );
    }

    return normalizedPath;
  }

  /**
   * Validate reference audio file path with relaxed security checks
   * Allows access to any user-accessible audio file on the system
   * Public for testing purposes
   */
  public validateReferenceAudioPath(filePath: string): string {
    if (!filePath || typeof filePath !== "string") {
      throw new Error("Reference audio path must be a non-empty string");
    }

    // Security: Prevent path traversal attacks by disallowing parent directory sequences
    if (filePath.includes("..")) {
      throw new Error("Path traversal sequences (..) are not allowed in reference audio paths");
    }

    // Resolve to absolute path to handle relative paths properly
    const resolvedPath = path.resolve(filePath);
    const normalizedPath = path.normalize(resolvedPath);

    // Check if file exists
    if (!fs.existsSync(normalizedPath)) {
      throw new Error(
        `Reference audio file not found: ${filePath} (resolved to: ${normalizedPath})`
      );
    }

    // Check if it's actually a file
    let stats;
    try {
      stats = fs.statSync(normalizedPath);
    } catch (error) {
      throw new Error(
        `Cannot access reference audio file: ${filePath}. Error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    if (!stats.isFile()) {
      throw new Error(
        `Reference audio path is not a file: ${filePath} (resolved to: ${normalizedPath})`
      );
    }

    // Validate file extension
    const ext = path.extname(normalizedPath).toLowerCase();
    const allowedExtensions = [".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"];
    if (!allowedExtensions.includes(ext)) {
      throw new Error(
        `Unsupported reference audio format: ${ext}. Supported formats: ${allowedExtensions.join(
          ", "
        )}. File: ${filePath}`
      );
    }

    logger.log(`Validated reference audio file: ${normalizedPath}`);
    return normalizedPath;
  }

  async synthesize(text: string, options: any): Promise<string> {
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new Error("Text must be a non-empty string");
    }

    const maxCharacters = parseInt(
      process.env.CHATTERBOX_MAX_CHARACTERS || "2000"
    );
    if (text.length > maxCharacters) {
      throw new Error(
        `Text exceeds maximum character limit of ${maxCharacters} characters. Current length: ${text.length}`
      );
    }

    const referenceAudio =
      options?.referenceAudio || process.env.CHATTERBOX_REFERENCE_AUDIO || "";
    const exaggeration =
      options?.exaggeration ??
      parseFloat(process.env.CHATTERBOX_EXAGGERATION || "0.2");
    const cfgWeight =
      options?.cfg_weight ??
      parseFloat(process.env.CHATTERBOX_CFG_WEIGHT || "1");

    // Create output directory if it doesn't exist
    const outputDir =
      process.env.CHATTERBOX_OUTPUT_DIR ||
      path.join(os.tmpdir(), "local-voice-mcp");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputFile = path.join(outputDir, `tts-${Date.now()}.wav`);

    // Validate reference audio path using relaxed validator (allows system-wide access)
    let validatedReferenceAudio = "";
    if (referenceAudio) {
      try {
        validatedReferenceAudio =
          this.validateReferenceAudioPath(referenceAudio);
        logger.log(`Using reference audio file: ${validatedReferenceAudio}`);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        logger.warn(
          `Reference audio validation failed: ${message}. Using default voice instead.`
        );
        validatedReferenceAudio = "";
      }
    }

    // Prepare arguments for the Python script
    const args = [
      this.scriptPath,
      "--text",
      this.sanitizeArg(text),
      "--output",
      outputFile,
      "--reference_audio",
      validatedReferenceAudio,
      "--exaggeration",
      String(exaggeration),
      "--cfg_weight",
      String(cfgWeight),
    ];

    logger.log("Python path:", this.pythonPath);
    logger.log("Script path:", this.scriptPath);
    logger.log("Arguments:", args);

    return new Promise<string>((resolve, reject) => {
      const childProcess = spawn(this.pythonPath, args);

      let stderrData = "";
      let stdoutData = "";

      if (childProcess.stderr) {
        childProcess.stderr.on("data", (data) => {
          const chunk = data.toString();
          stderrData += chunk;
          logger.log("TTS stderr:", chunk.trim());
        });
      }

      if (childProcess.stdout) {
        childProcess.stdout.on("data", (data) => {
          const chunk = data.toString();
          stdoutData += chunk;
          logger.log("TTS stdout:", chunk.trim());
        });
      }

      childProcess.on("error", (error) => {
        logger.error("TTS process error:", error);
        reject(error);
      });

      const startTime = Date.now();
      logger.log("TTS process started. Waiting for completion...");

      childProcess.on("close", (code) => {
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
          reject(new Error("TTS synthesis failed"));
        }
      });
    });
  }
}
