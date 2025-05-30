import argparse
from TTS.api import TTS

def main():
    parser = argparse.ArgumentParser(description='Coqui TTS Command Line Interface')
    parser.add_argument('--text', type=str, required=True, help='Text to synthesize')
    parser.add_argument('--voice', type=str, required=True, help='Voice model to use')
    parser.add_argument('--output', type=str, required=True, help='Output WAV file path')
    parser.add_argument('--pitch', type=float, default=1.0, help='Pitch adjustment (0.5-2.0)')
    parser.add_argument('--speed', type=float, default=1.0, help='Speed adjustment (0.5-2.0)')
    parser.add_argument('--emotion', type=str, default='neutral', help='Emotion preset')
    parser.add_argument('--emotion_strength', type=float, default=1.0, help='Emotion strength (0.0-1.0)')
    
    args = parser.parse_args()
    
    # Initialize TTS
    tts = TTS(model_name=args.voice, progress_bar=False, gpu=False)
    
    # Generate speech with prosody controls
    tts.tts_to_file(
        text=args.text,
        file_path=args.output,
        speaker=tts.speakers[0] if tts.speakers else None,
        language=tts.languages[0] if tts.languages else None,
        emotion=args.emotion,
        emotion_strength=args.emotion_strength,
        speed=args.speed,
        pitch=args.pitch
    )

if __name__ == '__main__':
    main()