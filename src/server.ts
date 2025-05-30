import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import fs from 'fs';
import { CoquiService } from './core/coqui.service';

interface TTSRequest {
  text: string;
  voice?: string;
  options?: {
    pitch?: number;
    speed?: number;
    emotion?: string;
    emotion_strength?: number;
  };
}

const app = express();
const port = 59125;
const coqui = new CoquiService();

app.use(bodyParser.json());

async function ttsHandler(req: Request<{}, {}, TTSRequest>, res: Response) {
  try {
    const { text, voice = 'tts_models/en/ljspeech/tacotron2-DDC', options = {} } = req.body;

    if (!text) {
      res.status(400).json({ error: 'Text parameter is required' });
      return;
    }

    const audioPath = await coqui.synthesize(text, voice, options);
    
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', 'attachment; filename=tts.wav');
    
    const audioStream = fs.createReadStream(audioPath);
    audioStream.pipe(res);
    
    audioStream.on('end', () => {
      // Clean up temporary file
      fs.unlink(audioPath, (err) => {
        if (err) console.error('Error deleting temp file:', err);
      });
    });

    audioStream.on('error', (err) => {
      console.error('Stream error:', err);
      res.status(500).json({ error: 'Audio streaming failed' });
    });
  } catch (error: any) {
    console.error('TTS error:', error);
    res.status(500).json({
      error: 'TTS synthesis failed',
      details: error.message
    });
  }
}

app.post('/tts', ttsHandler);

app.listen(port, () => {
  console.log(`Local Voice MCP server running at http://localhost:${port}`);
});