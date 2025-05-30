import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { promisify } from 'util';

const exec = promisify(require('child_process').exec);

export class CoquiService {
  private venvPath: string;
  private scriptPath: string;

  constructor() {
    this.venvPath = path.join(os.homedir(), '.local-voice-mcp', 'venv');
    this.scriptPath = path.join(__dirname, '..', '..', 'scripts', 'coqui_tts.py');
  }

  async setupEnvironment(): Promise<void> {
    // Create virtual environment if not exists
    if (!fs.existsSync(this.venvPath)) {
      await exec(`python3 -m venv ${this.venvPath}`);
    }

    // Install Coqui TTS
    const pipPath = path.join(this.venvPath, 'bin', 'pip');
    await exec(`${pipPath} install TTS`);
  }

  async synthesize(text: string, voice: string, options: any): Promise<string> {
    // Ensure environment is set up
    await this.setupEnvironment();

    // Create output file
    const outputDir = path.join(os.tmpdir(), 'local-voice-mcp');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputFile = path.join(outputDir, `tts-${Date.now()}.wav`);

    // Build command arguments
    const pythonPath = path.join(this.venvPath, 'bin', 'python');
    const args = [
      this.scriptPath,
      `--text=${text}`,
      `--voice=${voice}`,
      `--output=${outputFile}`
    ];

    // Add options
    if (options.pitch) args.push(`--pitch=${options.pitch}`);
    if (options.speed) args.push(`--speed=${options.speed}`);
    if (options.emotion) args.push(`--emotion=${options.emotion}`);
    if (options.emotion_strength) args.push(`--emotion_strength=${options.emotion_strength}`);

    // Execute Python script
    return new Promise((resolve, reject) => {
      const process = spawn(pythonPath, args);

      process.stdout.on('data', (data) => console.log(data.toString()));
      process.stderr.on('data', (data) => console.error(data.toString()));

      process.on('close', (code) => {
        if (code === 0) {
          resolve(outputFile);
        } else {
          reject(new Error(`Coqui TTS exited with code ${code}`));
        }
      });

      process.on('error', (err) => {
        reject(new Error(`TTS synthesis failed: ${err.message}`));
      });
    });
  }
}