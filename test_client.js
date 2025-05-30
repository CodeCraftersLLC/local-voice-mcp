const axios = require('axios');
const fs = require('fs');

async function testTTS() {
  try {
    const response = await axios.post(
      'http://localhost:59125/tts',
      {
        text: 'Hello world, this is a test of the Chatterbox TTS system',
        voice: 'en_speaker_0',
        options: {
          pitch: 1.1,
          speed: 1.2,
          emotion: 'neutral'
        }
      },
      {
        responseType: 'stream'
      }
    );

    const writer = fs.createWriteStream('test_output.wav');
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

testTTS().then(() => {
  console.log('Test completed. Audio saved to test_output.wav');
});