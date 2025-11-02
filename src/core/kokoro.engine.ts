/**
 * Kokoro TTS Engine Implementation
 * 
 * Wraps the Kokoro TTS Python library for text-to-speech synthesis.
 * Supports multiple languages, voices, voice blending, and adjustable speed.
 */

import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as https from "https";
import { logger } from "../utils/logger";
import { ITTSEngine, TTSOptions, TTSEngineStatus } from "./tts-engine.interface";
import { KOKORO_DEFAULTS, KOKORO_LIMITS, COMMON_CONSTANTS } from "./tts-constants";

export class KokoroEngine implements ITTSEngine {
  readonly engineName = "kokoro";
  
  private pythonPath: string;
  private scriptPath: string;
  private envReady: boolean = false;
  private readyPromise: Promise<void> | null = null;

  constructor() {
    this.pythonPath = this.resolvePythonPath();
    this.scriptPath = path.join(__dirname, "../../scripts/kokoro_runner.py");
  }

  private resolvePythonPath(): string {
    return process.env.PYTHON_PATH || COMMON_CONSTANTS.PYTHON_DEFAULT_PATH;
  }

  async ensureReady(): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = this.setupEnvironment();
    return this.readyPromise;
  }

  private async setupEnvironment(): Promise<void> {
    try {
      if (!fs.existsSync(this.scriptPath)) {
        throw new Error(
          `Kokoro Python script not found at: ${this.scriptPath}`
        );
      }

      // Download model files if needed
      await this.ensureModelFiles();

      await this.verifyDependencies();
      this.envReady = true;
      logger.log("[KokoroEngine] Environment setup complete");
    } catch (error) {
      this.envReady = false;
      throw new Error(
        `Failed to initialize Kokoro engine: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async ensureModelFiles(): Promise<void> {
    // Create cache directory for model files
    const cacheDir = path.join(os.homedir(), ".cache", "kokoro-tts");
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const modelPath = path.join(cacheDir, "kokoro-v1.0.onnx");
    const voicesPath = path.join(cacheDir, "voices-v1.0.bin");

    // Set environment variables so Python script can find the files
    process.env.KOKORO_MODEL_PATH = modelPath;
    process.env.KOKORO_VOICES_PATH = voicesPath;

    const downloads: Promise<void>[] = [];

    // Download model file if not exists
    if (!fs.existsSync(modelPath)) {
      logger.log("[KokoroEngine] Downloading kokoro-v1.0.onnx (~90MB)...");
      downloads.push(
        this.downloadFile(
          "https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx",
          modelPath
        )
      );
    } else {
      logger.log("[KokoroEngine] Model file already exists");
    }

    // Download voices file if not exists
    if (!fs.existsSync(voicesPath)) {
      logger.log("[KokoroEngine] Downloading voices-v1.0.bin (~13MB)...");
      downloads.push(
        this.downloadFile(
          "https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin",
          voicesPath
        )
      );
    } else {
      logger.log("[KokoroEngine] Voices file already exists");
    }

    // Wait for all downloads to complete
    if (downloads.length > 0) {
      await Promise.all(downloads);
      logger.log("[KokoroEngine] Model files downloaded successfully");
    }
  }

  private downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      let downloadedBytes = 0;
      let totalBytes = 0;

      https.get(url, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            file.close();
            fs.unlinkSync(dest);
            return this.downloadFile(redirectUrl, dest).then(resolve).catch(reject);
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
          return;
        }

        totalBytes = parseInt(response.headers['content-length'] || '0', 10);

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const percent = totalBytes > 0 ? ((downloadedBytes / totalBytes) * 100).toFixed(1) : '?';
          const mb = (downloadedBytes / 1024 / 1024).toFixed(1);
          logger.log(`[KokoroEngine] Downloaded ${mb}MB (${percent}%)`);
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          logger.log(`[KokoroEngine] Download complete: ${path.basename(dest)}`);
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => {}); // Delete partial file
        reject(err);
      });

      file.on('error', (err) => {
        fs.unlink(dest, () => {}); // Delete partial file
        reject(err);
      });
    });
  }

  private async verifyDependencies(): Promise<void> {
    return new Promise((resolve, reject) => {
      const checkProcess = spawn(this.pythonPath, [
        "-c",
        "import kokoro_onnx; import soundfile; import numpy; print('✅ All Kokoro dependencies installed successfully!')",
      ]);

      let output = "";
      let errorOutput = "";

      checkProcess.stdout?.on("data", (data) => {
        output += data.toString();
        logger.log("[KokoroEngine] stdout:", data.toString().trim());
      });

      checkProcess.stderr?.on("data", (data) => {
        errorOutput += data.toString();
        logger.error("[KokoroEngine] stderr:", data.toString().trim());
      });

      checkProcess.on("close", async (code) => {
        if (code === 0 && output.includes("✅")) {
          logger.log("[KokoroEngine] All required Python dependencies are installed");
          resolve();
        } else {
          // Dependencies not installed - try to install them automatically
          logger.log("[KokoroEngine] Dependencies not found, installing automatically...");
          try {
            await this.installDependencies();
            logger.log("[KokoroEngine] Dependencies installed successfully");
            resolve();
          } catch (installError) {
            reject(installError);
          }
        }
      });

      checkProcess.on("error", (error) => {
        reject(
          new Error(`Failed to verify Kokoro dependencies: ${error.message}`)
        );
      });
    });
  }

  private async installDependencies(): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.log("[KokoroEngine] Installing kokoro-onnx, soundfile, and numpy...");
      
      // Use pip to install the requirements file
      const requirementsPath = path.join(__dirname, "../../scripts/requirements-kokoro.txt");
      const installProcess = spawn(this.pythonPath, [
        "-m",
        "pip",
        "install",
        "-q",  // Quiet mode
        "-r",
        requirementsPath,
      ]);

      let output = "";
      let errorOutput = "";

      installProcess.stdout?.on("data", (data) => {
        output += data.toString();
        logger.log("[KokoroEngine] Install:", data.toString().trim());
      });

      installProcess.stderr?.on("data", (data) => {
        errorOutput += data.toString();
        // pip writes progress to stderr, so only log warnings/errors
        const msg = data.toString().trim();
        if (msg.toLowerCase().includes("error") || msg.toLowerCase().includes("warning")) {
          logger.warn("[KokoroEngine] Install stderr:", msg);
        }
      });

      installProcess.on("close", (code) => {
        if (code === 0) {
          logger.log("[KokoroEngine] Python packages installed successfully");
          resolve();
        } else {
          reject(
            new Error(
              `Failed to install Kokoro dependencies automatically.\n` +
              `Please install manually:\n` +
              `  pip install kokoro-onnx soundfile numpy\n\n` +
              `Error details: ${errorOutput || "Unknown installation error"}`
            )
          );
        }
      });

      installProcess.on("error", (error) => {
        reject(
          new Error(
            `Failed to run pip installer: ${error.message}\n` +
            `Please install dependencies manually:\n` +
            `  pip install kokoro-onnx soundfile numpy`
          )
        );
      });
    });
  }

  async synthesize(text: string, options: TTSOptions): Promise<string> {
    if (!this.envReady) {
      throw new Error("Kokoro engine is not ready. Call ensureReady() first.");
    }

    if (typeof text !== "string" || text.trim().length === 0) {
      throw new Error("Text must be a non-empty string");
    }

    const maxCharacters = parseInt(
      process.env.KOKORO_MAX_CHARACTERS || String(KOKORO_DEFAULTS.MAX_CHARACTERS)
    );
    if (text.length > maxCharacters) {
      throw new Error(
        `Text exceeds maximum character limit of ${maxCharacters} characters. Current length: ${text.length}`
      );
    }

    const speed =
      options?.speed ??
      parseFloat(process.env.KOKORO_SPEED || String(KOKORO_DEFAULTS.SPEED));
    const language =
      options?.language ??
      (process.env.KOKORO_LANGUAGE || KOKORO_DEFAULTS.LANGUAGE);
    const voice =
      options?.voice ??
      (process.env.KOKORO_VOICE || KOKORO_DEFAULTS.VOICE);
    const modelPath =
      options?.model_path ??
      (process.env.KOKORO_MODEL_PATH || path.join(os.homedir(), ".cache", "kokoro-tts", "kokoro-v1.0.onnx"));
    const voicesPath =
      options?.voices_path ??
      (process.env.KOKORO_VOICES_PATH || path.join(os.homedir(), ".cache", "kokoro-tts", "voices-v1.0.bin"));

    const outputDir =
      process.env.KOKORO_OUTPUT_DIR ||
      path.join(os.tmpdir(), COMMON_CONSTANTS.TEMP_DIR_NAME);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputFile = path.join(outputDir, `kokoro-tts-${Date.now()}.wav`);

    const args = [
      this.scriptPath,
      "--text",
      text,
      "--output",
      outputFile,
      "--speed",
      String(speed),
      "--lang",
      language,
      "--voice",
      voice,
      "--model",
      modelPath,
      "--voices",
      voicesPath,
    ];

    logger.log("[KokoroEngine] Python path:", this.pythonPath);
    logger.log("[KokoroEngine] Script path:", this.scriptPath);
    logger.log("[KokoroEngine] Arguments:", args);

    return new Promise<string>((resolve, reject) => {
      const childProcess = spawn(this.pythonPath, args);

      let stderrData = "";
      let stdoutData = "";

      if (childProcess.stderr) {
        childProcess.stderr.on("data", (data) => {
          const chunk = data.toString();
          stderrData += chunk;
          logger.log("[KokoroEngine] stderr:", chunk.trim());
        });
      }

      if (childProcess.stdout) {
        childProcess.stdout.on("data", (data) => {
          const chunk = data.toString();
          stdoutData += chunk;
          logger.log("[KokoroEngine] stdout:", chunk.trim());
        });
      }

      childProcess.on("error", (error) => {
        logger.error("[KokoroEngine] process error:", error);
        reject(error);
      });

      const startTime = Date.now();
      logger.log("[KokoroEngine] TTS process started. Waiting for completion...");

      childProcess.on("close", (code) => {
        const duration = Date.now() - startTime;
        logger.log(
          `[KokoroEngine] Process closed with code ${code} after ${duration}ms`
        );

        if (code === 0 && fs.existsSync(outputFile)) {
          logger.log(
            `[KokoroEngine] Synthesis completed successfully in ${duration}ms`
          );
          resolve(outputFile);
        } else {
          logger.error(
            `[KokoroEngine] Synthesis failed after ${duration}ms with code ${code}`
          );
          logger.error("[KokoroEngine] Error output (stderr):", stderrData);
          logger.error("[KokoroEngine] Standard output (stdout):", stdoutData);
          reject(new Error("Kokoro synthesis failed"));
        }
      });
    });
  }

  async getStatus(): Promise<TTSEngineStatus> {
    return {
      ready: this.envReady,
      capabilities: [
        "multi-language",
        "multi-voice",
        "voice-blending",
        "speed-control",
        "long-form-content",
        "gpu-support"
      ],
      version: "1.0.0",
      engineName: this.engineName
    };
  }

  validateOptions(options: TTSOptions): void {
    if (
      options.speed !== undefined &&
      (options.speed < KOKORO_LIMITS.SPEED_MIN || 
       options.speed > KOKORO_LIMITS.SPEED_MAX)
    ) {
      throw new Error(
        `Speed must be between ${KOKORO_LIMITS.SPEED_MIN} and ${KOKORO_LIMITS.SPEED_MAX}`
      );
    }

    // Validate language if provided (actual validation happens in Python)
    if (options.language !== undefined && typeof options.language !== "string") {
      throw new Error("Language must be a string");
    }

    // Validate voice if provided (actual validation happens in Python)
    if (options.voice !== undefined && typeof options.voice !== "string") {
      throw new Error("Voice must be a string");
    }
  }

  async shutdown(): Promise<void> {
    this.envReady = false;
    this.readyPromise = null;
    return Promise.resolve();
  }
}

