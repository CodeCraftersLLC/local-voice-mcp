const axios = require("axios");
const fs = require("fs");

// Replace with your actual API key if required
const API_KEY = "your-api-key-here";

async function testTTS() {
  try {
    const response = await axios.post(
      "http://localhost:59125/tts",
      {
        // text: 'Hello world, this is a test of the Chatterbox TTS system',
        text: "Now let's make my mum's favourite. So three mars bars into the pan. Then we add the tuna and just stir for a bit, just let the chocolate and fish infuse. A sprinkle of olive oil and some tomato ketchup. Now smell that. Oh boy this is going to be incredible.",
        options: {
          referenceAudio: "female-reference-voice.wav",
          exaggeration: 1.0,
          cfg_weight: 1.0,
        },
      },
      {
        responseType: "stream",
        headers: {
          "x-api-key": API_KEY,
        },
      }
    );

    const writer = fs.createWriteStream("test_output.wav");
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      let finished = false;

      const cleanup = () => {
        if (!finished) {
          finished = true;
          return true;
        }
        return false;
      };

      writer.on("finish", () => {
        if (cleanup()) {
          resolve();
        }
      });

      writer.on("error", (err) => {
        if (cleanup()) {
          reject(err);
        } else {
          console.error("Error after finish:", err);
        }
      });
    });
  } catch (error) {
    if (error.response) {
      // The request was made and the server responded with a status code
      console.error(`Test failed with status ${error.response.status}:`);
      try {
        // Try to parse JSON error response
        const errorBody = JSON.parse(error.response.data);
        console.error("Error details:", errorBody);
      } catch (e) {
        console.error("Response data:", error.response.data);
      }
    } else if (error.request) {
      // The request was made but no response was received
      console.error("No response received:", error.message);
    } else {
      // Something happened in setting up the request
      console.error("Request setup error:", error.message);
    }
  }
}

testTTS().then(() => {
  console.log("Test completed. Audio saved to test_output.wav");
});
