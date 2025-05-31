import express, { Request, Response, NextFunction } from 'express';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { finished } from 'stream';
import { ChatterboxService } from './core/chatterbox.service';

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
const TEMP_AUDIO_DIR = path.join(os.tmpdir(), 'local-voice-mcp');

// Create temp directory if it doesn't exist
if (!fs.existsSync(TEMP_AUDIO_DIR)) {
  fs.mkdirSync(TEMP_AUDIO_DIR, { recursive: true });
}

app.use(bodyParser.json());

// Authentication middleware placeholder
const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    res.status(401).json({ error: 'API key required' });
    return;
  }
  
  // In a real implementation, validate against database or environment variable
  // For now, we'll just log and proceed as a placeholder
  console.log(`Authentication placeholder: API key ${apiKey} received`);
  next();
};

async function ttsHandler(req: Request<{}, {}, TTSRequest>, res: Response) {
  try {
    const { text, options = {} } = req.body;

    if (!text) {
      res.status(400).json({ error: 'Text parameter is required' });
      return;
    }

    let audioPath: string;
    try {
      audioPath = await chatterbox.synthesize(text, options);
    } catch (error) {
      console.error('TTS synthesis error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'TTS synthesis failed' });
      }
      return;
    }
    
    // Validate audio path to prevent directory traversal
    const resolvedPath = path.resolve(audioPath);
    const normalizedTempDir = path.normalize(TEMP_AUDIO_DIR) + path.sep;
    
    if (!resolvedPath.startsWith(normalizedTempDir)) {
      console.error(`Directory traversal attempt: ${resolvedPath} not in ${normalizedTempDir}`);
      throw new Error('Invalid audio path: attempted directory traversal');
    }

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', 'attachment; filename=tts.wav');
    
    const audioStream = fs.createReadStream(audioPath);
    audioStream.pipe(res);
    
    // Use finished for robust cleanup handling
    finished(audioStream, (err) => {
      if (err) {
        console.error('Stream finished with error:', err);
      }
      
      // Clean up temporary file
      fs.unlink(audioPath, (unlinkErr) => {
        if (unlinkErr) console.error('Error deleting temp file:', unlinkErr);
      });
    });

    audioStream.on('error', (err) => {
      console.error('Stream error:', err);
      
      // Only send error response if headers haven't been sent
      if (!res.headersSent) {
        res.status(500).json({ error: 'Audio streaming failed' });
      }
      // Otherwise, just end the response to avoid ERR_HTTP_HEADERS_SENT
      else {
        res.end();
      }
    });
  } catch (error) {
    console.error('TTS error:', error);
    
    // Avoid sending headers if already sent
    if (!res.headersSent) {
      res.status(500).json({ error: 'TTS synthesis failed' });
    }
  }
}

app.post('/tts', authenticate, ttsHandler);

app.listen(port, () => {
  console.log(`Local Voice MCP server running at http://localhost:${port}`);
});