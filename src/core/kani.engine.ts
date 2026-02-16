/**
 * Kani TTS 2 Engine Implementation
 *
 * Wraps the Kani TTS 2 Python library for text-to-speech synthesis.
 * Supports voice cloning via speaker embeddings extracted from reference audio.
 * Models are auto-downloaded from HuggingFace on first use.
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { logger } from "../utils/logger";
import {
  ITTSEngine,
  TTSOptions,
  TTSEngineStatus,
} from "./tts-engine.interface";
import { KANI_DEFAULTS, KANI_LIMITS, COMMON_CONSTANTS } from "./tts-constants";

export class KaniEngine implements ITTSEngine {
  readonly engineName = "kani";

  private pythonPath: string;
  private scriptPath: string;
  private envReady: boolean = false;
  private readyPromise: Promise<void> | null = null;

  constructor() {
    this.pythonPath = this.resolvePythonPath();
    this.scriptPath = path.join(__dirname, "../../scripts/kani_runner.py");
  }

  private resolvePythonPath(): string {
    return process.env.PYTHON_PATH || COMMON_CONSTANTS.PYTHON_DEFAULT_PATH;
  }

  async ensureReady(): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = this.setupEnvironment().catch((error) => {
      this.readyPromise = null;
      throw error;
    });
    return this.readyPromise;
  }

  private async setupEnvironment(): Promise<void> {
    try {
      if (!fs.existsSync(this.scriptPath)) {
        throw new Error(
          `Kani Python script not found at: ${this.scriptPath}`
        );
      }

      // No manual model download needed - HuggingFace auto-downloads on first use
      await this.verifyDependencies();
      this.envReady = true;
      logger.log("[KaniEngine] Environment setup complete");
    } catch (error) {
      this.envReady = false;
      throw new Error(
        `Failed to initialize Kani engine: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async verifyDependencies(): Promise<void> {
    return new Promise((resolve, reject) => {
      const checkProcess = spawn(this.pythonPath, [
        "-c",
        "import kani_tts; import soundfile; import numpy; print('OK')",
      ]);

      let output = "";
      let errorOutput = "";

      checkProcess.stdout?.on("data", (data) => {
        output += data.toString();
        logger.log("[KaniEngine] stdout:", data.toString().trim());
      });

      checkProcess.stderr?.on("data", (data) => {
        errorOutput += data.toString();
        logger.error("[KaniEngine] stderr:", data.toString().trim());
      });

      checkProcess.on("close", async (code) => {
        if (code === 0 && output.includes("OK")) {
          logger.log(
            "[KaniEngine] All required Python dependencies are installed"
          );
          resolve();
        } else {
          logger.log(
            "[KaniEngine] Dependencies not found, installing automatically..."
          );
          try {
            await this.installDependencies();
            logger.log("[KaniEngine] Dependencies installed successfully");
            resolve();
          } catch (installError) {
            reject(installError);
          }
        }
      });

      checkProcess.on("error", (error) => {
        reject(
          new Error(
            `Failed to verify Kani dependencies: ${error.message}`
          )
        );
      });
    });
  }

  private async installDependencies(): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.log(
        "[KaniEngine] Installing kani-tts-2, transformers, soundfile, and numpy..."
      );

      const requirementsPath = path.join(
        __dirname,
        "../../scripts/requirements-kani.txt"
      );
      const installProcess = spawn(this.pythonPath, [
        "-m",
        "pip",
        "install",
        "-q",
        "-r",
        requirementsPath,
      ]);

      let output = "";
      let errorOutput = "";

      installProcess.stdout?.on("data", (data) => {
        output += data.toString();
        logger.log("[KaniEngine] Install:", data.toString().trim());
      });

      installProcess.stderr?.on("data", (data) => {
        errorOutput += data.toString();
        const msg = data.toString().trim();
        if (
          msg.toLowerCase().includes("error") ||
          msg.toLowerCase().includes("warning")
        ) {
          logger.warn("[KaniEngine] Install stderr:", msg);
        }
      });

      installProcess.on("close", (code) => {
        if (code === 0) {
          logger.log("[KaniEngine] Python packages installed successfully");
          resolve();
        } else {
          reject(
            new Error(
              `Failed to install Kani dependencies automatically.\n` +
                `Please install manually:\n` +
                `  pip install kani-tts-2 transformers==4.56.0 soundfile numpy\n\n` +
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
              `  pip install kani-tts-2 transformers==4.56.0 soundfile numpy`
          )
        );
      });
    });
  }

  async synthesize(text: string, options: TTSOptions): Promise<string> {
    if (!this.envReady) {
      throw new Error("Kani engine is not ready. Call ensureReady() first.");
    }

    if (typeof text !== "string" || text.trim().length === 0) {
      throw new Error("Text must be a non-empty string");
    }

    const maxCharacters = parseInt(
      process.env.KANI_MAX_CHARACTERS || String(KANI_DEFAULTS.MAX_CHARACTERS)
    );
    if (text.length > maxCharacters) {
      throw new Error(
        `Text exceeds maximum character limit of ${maxCharacters} characters. Current length: ${text.length}`
      );
    }

    const model =
      options?.model ??
      (process.env.KANI_MODEL || KANI_DEFAULTS.MODEL);
    const temperature =
      options?.temperature ??
      parseFloat(
        process.env.KANI_TEMPERATURE || String(KANI_DEFAULTS.TEMPERATURE)
      );
    const topP =
      options?.top_p ??
      parseFloat(process.env.KANI_TOP_P || String(KANI_DEFAULTS.TOP_P));
    const repetitionPenalty =
      options?.repetition_penalty ??
      parseFloat(
        process.env.KANI_REPETITION_PENALTY ||
          String(KANI_DEFAULTS.REPETITION_PENALTY)
      );
    const referenceAudio =
      options?.referenceAudio || process.env.KANI_REFERENCE_AUDIO || "";
    const languageTag =
      options?.language ?? (process.env.KANI_LANGUAGE_TAG || "");

    const outputDir =
      process.env.KANI_OUTPUT_DIR ||
      path.join(os.tmpdir(), COMMON_CONSTANTS.TEMP_DIR_NAME);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputFile = path.join(outputDir, `kani-tts-${Date.now()}.wav`);

    const args = [
      this.scriptPath,
      "--text",
      text,
      "--output",
      outputFile,
      "--model",
      model,
      "--temperature",
      String(temperature),
      "--top_p",
      String(topP),
      "--repetition_penalty",
      String(repetitionPenalty),
    ];

    if (referenceAudio) {
      args.push("--reference_audio", referenceAudio);
    }

    if (languageTag) {
      args.push("--language_tag", languageTag);
    }

    logger.log("[KaniEngine] Python path:", this.pythonPath);
    logger.log("[KaniEngine] Script path:", this.scriptPath);
    logger.log("[KaniEngine] Arguments:", args);

    return new Promise<string>((resolve, reject) => {
      const childProcess = spawn(this.pythonPath, args);

      let stderrData = "";
      let stdoutData = "";

      if (childProcess.stderr) {
        childProcess.stderr.on("data", (data) => {
          const chunk = data.toString();
          stderrData += chunk;
          logger.log("[KaniEngine] stderr:", chunk.trim());
        });
      }

      if (childProcess.stdout) {
        childProcess.stdout.on("data", (data) => {
          const chunk = data.toString();
          stdoutData += chunk;
          logger.log("[KaniEngine] stdout:", chunk.trim());
        });
      }

      childProcess.on("error", (error) => {
        logger.error("[KaniEngine] process error:", error);
        reject(error);
      });

      const startTime = Date.now();
      logger.log(
        "[KaniEngine] TTS process started. Waiting for completion..."
      );

      childProcess.on("close", (code) => {
        const duration = Date.now() - startTime;
        logger.log(
          `[KaniEngine] Process closed with code ${code} after ${duration}ms`
        );

        if (code === 0 && fs.existsSync(outputFile)) {
          logger.log(
            `[KaniEngine] Synthesis completed successfully in ${duration}ms`
          );
          resolve(outputFile);
        } else {
          logger.error(
            `[KaniEngine] Synthesis failed after ${duration}ms with code ${code}`
          );
          logger.error("[KaniEngine] Error output (stderr):", stderrData);
          logger.error("[KaniEngine] Standard output (stdout):", stdoutData);
          reject(new Error("Kani synthesis failed"));
        }
      });
    });
  }

  async getStatus(): Promise<TTSEngineStatus> {
    return {
      ready: this.envReady,
      capabilities: [
        "voice-cloning",
        "speaker-embeddings",
        "temperature-control",
        "huggingface-models",
        "gpu-support",
      ],
      version: "2.0.0",
      engineName: this.engineName,
    };
  }

  validateOptions(options: TTSOptions): void {
    if (
      options.temperature !== undefined &&
      (options.temperature < KANI_LIMITS.TEMPERATURE_MIN ||
        options.temperature > KANI_LIMITS.TEMPERATURE_MAX)
    ) {
      throw new Error(
        `Temperature must be between ${KANI_LIMITS.TEMPERATURE_MIN} and ${KANI_LIMITS.TEMPERATURE_MAX}`
      );
    }

    if (
      options.top_p !== undefined &&
      (options.top_p < KANI_LIMITS.TOP_P_MIN ||
        options.top_p > KANI_LIMITS.TOP_P_MAX)
    ) {
      throw new Error(
        `top_p must be between ${KANI_LIMITS.TOP_P_MIN} and ${KANI_LIMITS.TOP_P_MAX}`
      );
    }

    if (
      options.repetition_penalty !== undefined &&
      (options.repetition_penalty < KANI_LIMITS.REPETITION_PENALTY_MIN ||
        options.repetition_penalty > KANI_LIMITS.REPETITION_PENALTY_MAX)
    ) {
      throw new Error(
        `repetition_penalty must be between ${KANI_LIMITS.REPETITION_PENALTY_MIN} and ${KANI_LIMITS.REPETITION_PENALTY_MAX}`
      );
    }

    if (options.language !== undefined && typeof options.language !== "string") {
      throw new Error("Language tag must be a string");
    }
  }

  async shutdown(): Promise<void> {
    this.envReady = false;
    this.readyPromise = null;
    return Promise.resolve();
  }
}
