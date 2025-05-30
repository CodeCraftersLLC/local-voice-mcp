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

      // Install Chatterbox TTS
      const pipPath = path.join(this.venvPath, 'bin', 'pip');
      console.log('Installing chatterbox-tts package...');
      
      const { stdout: installStdout, stderr: installStderr } = await exec(`${pipPath} install chatterbox-tts`);
      console.log('Installation completed with status:');
      if (installStdout) console.log(installStdout);
      if (installStderr) console.error(installStderr);
      
      console.log('chatterbox-tts installed successfully.');
      
      // Verify installation
      console.log('Verifying package installation...');
      const { stdout: listStdout, stderr: listStderr } = await exec(`${pipPath} list`);
      console.log('Installed packages:', listStdout);
      if (listStderr) console.error(listStderr);
    } catch (error) {
      console.error('Error setting up environment:', error);
      throw error;
    }
  }

  async synthesize(text: string, voice: string, options: any): Promise<string> {
    await this.setupEnvironment();

    const outputDir = path.join(os.tmpdir(), 'local-voice-mcp');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputFile = path.join(outputDir, `tts-${Date.now()}.wav`);

    const pythonPath = path.join(this.venvPath, 'bin', 'python');
    const args = [
      this.scriptPath,
      `--text=${text}`,
      `--voice=${voice}`,
      `--output=${outputFile}`
    ];

    if (options.pitch) args.push(`--pitch=${options.pitch}`);
    if (options.speed) args.push(`--speed=${options.speed}`);
    if (options.emotion) args.push(`--emotion=${options.emotion}`);

    return new Promise((resolve, reject) => {
      console.log(`Starting TTS synthesis with voice: ${voice}`);
      const command = `${pythonPath} ${args.join(' ')}`;
      console.log(`Executing: ${command}`);
      
      const process = spawn(pythonPath, args);
      
      console.log('TTS process started. Waiting for completion...');

      let stderrData = '';
      process.stderr.on('data', (data) => {
        stderrData += data.toString();
        console.error(data.toString());
      });

      process.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputFile)) {
          resolve(outputFile);
        } else {
          reject(new Error(`Chatterbox TTS failed: ${stderrData}`));
        }
      });

      process.on('error', (err) => {
        reject(new Error(`Chatterbox TTS error: ${err.message}`));
      });
    });
  }
}