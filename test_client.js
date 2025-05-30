const axios = require('axios');
const fs = require('fs');
const { Readable } = require('stream');

async function testTTS() {
  try {
    const response = await axios.post(
      'http://localhost:59125/tts',
      {
        text: `
        Why a Short Poem?
A short poem may be a stylistic choice or it may be that you have said what you intended to say in a more concise way. Either way, they differ stylistically from a long poem in that there tends to be more care in word choice. Since there are fewer words people tend to spend more time on choosing a word that fits the subject to perfection. Because of this meticulous attitude, writing a short poem is often more tedious than writing a long poem.
`,
        voice: 'tts_models/en/ljspeech/tacotron2-DDC',
        options: {
          pitch: 1.1,
          speed: 1.2,
          emotion: 'happy'
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