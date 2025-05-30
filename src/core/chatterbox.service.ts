import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { promisify } from 'util';

const exec = promisify(require('child_process').exec);

export class ChatterboxService {
  private venvPath: string;
  private scriptPath: string;

  constructor() {
    this.venvPath = path.join(os.homedir(), '.local-voice-mcp', 'venv');
    this.scriptPath = path.join(__dirname, '..', '..', 'scripts', 'tts_runner.py');
  }

  async setupEnvironment(): Promise<void> {
    try {
      // Create virtual environment if not exists
      if (!fs.existsSync(this.venvPath)) {
        console.log(`Creating virtual environment at ${this.venvPath}...`);
        const { stdout, stderr } = await exec(`python3 -m venv ${this.venvPath}`);
        console.log('Virtual environment created.');
        if (stdout) console.log(stdout);
        if (stderr) console.error(stderr);
      }

      // Install PyTorch and TTS package
      const pipPath = path.join(this.venvPath, 'bin', 'pip');
      console.log('Installing PyTorch and TTS...');
      
      const commands = [
        `${pipPath} install torch torchaudio`,
        `${pipPath} install TTS`
      ];
      
      for (const cmd of commands) {
        const { stdout, stderr } = await exec(cmd);
        if (stdout) console.log(stdout);
        if (stderr) console.error(stderr);
      }
      
      console.log('TTS dependencies installed successfully.');
      
      // Verify installation
      console.log('Verifying package installation...');
      const { stdout: listStdout, stderr: listStderr } = await exec(`${pipPath} list`);
      console.log('Installed packages:', listStdout);
      if (listStderr) console.error(listStderr);
    } catch (error) {
      console.error('Error setting up environment');
      throw new Error('Environment setup failed');
    }
  }

  private environmentSetupPromise: Promise<void> | null = null;

  private async initializeEnvironment(): Promise<void> {
    if (!this.environmentSetupPromise) {
      this.environmentSetupPromise = this.setupEnvironment();
    }
    return this.environmentSetupPromise;
  }

  async synthesize(text: string, options: any): Promise<string> {
    try {
      await this.initializeEnvironment();
    } catch (error) {
      console.error('Environment setup failed');
      throw new Error('TTS environment not ready');
    }

    const outputDir = path.join(os.tmpdir(), 'local-voice-mcp');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputFile = path.join(outputDir, `tts-${Date.now()}.wav`);

    const pythonPath = path.join(this.venvPath, 'bin', 'python');
    const sanitizeArg = (val: any): string => {
      if (typeof val === 'string') {
        // More restrictive sanitization to prevent command injection
        return val.replace(/[^a-zA-Z0-9_\-.,= ]/g, '');
      }
      return String(val);
    };

    const args = [
      this.scriptPath,
      `--text=${sanitizeArg(text)}`,
      `--output=${outputFile}`
    ];

    // Add reference audio if provided
    if (options?.referenceAudio) {
      args.push(`--reference_audio=${sanitizeArg(options.referenceAudio)}`);
    }

    // Add other parameters
    if (options?.pitch) args.push(`--pitch=${sanitizeArg(options.pitch)}`);
    if (options?.speed) args.push(`--speed=${sanitizeArg(options.speed)}`);
    if (options?.emotion) args.push(`--emotion=${sanitizeArg(options.emotion)}`);

    return new Promise((resolve, reject) => {
      console.log('Starting TTS synthesis');
      
      const process = spawn(pythonPath, args);
      console.log('TTS process started. Waiting for completion...');

      let stderrData = '';
      process.stderr.on('data', (data) => {
        stderrData += data.toString();
      });

      const startTime = Date.now();
      
      process.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputFile)) {
          const duration = Date.now() - startTime;
          console.log(`TTS synthesis completed successfully in ${duration}ms`);
          resolve(outputFile);
        } else {
          const duration = Date.now() - startTime;
          console.error(`TTS synthesis failed after ${duration}ms with code ${code}`);
          console.error('Error output:', stderrData);
          reject(new Error(`TTS synthesis failed: ${stderrData}`));
        }
      });

      process.on('error', (err) => {
        console.error('TTS process error');
        reject(new Error('TTS process error'));
      });
    });
  }
}