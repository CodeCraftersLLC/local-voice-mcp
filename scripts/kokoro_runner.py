#!/usr/bin/env python3
"""
Kokoro TTS Runner Script

This script provides a simple command-line interface to the Kokoro TTS system.
It handles text input, generates speech using the Kokoro ONNX model, and outputs
a WAV file.

Usage:
    python kokoro_runner.py --text "Your text here" --output output.wav [options]
"""

import argparse
import sys
import os
import traceback
from pathlib import Path

# Import Kokoro components
try:
    from kokoro_onnx import Kokoro
    import soundfile as sf
except ImportError as e:
    print(f"Error: Required dependency not found: {e}", file=sys.stderr)
    print("Please install required packages:", file=sys.stderr)
    print("  pip install kokoro-onnx soundfile numpy", file=sys.stderr)
    sys.exit(1)

# Configuration constants
DEFAULT_SPEED = 1.0
DEFAULT_LANGUAGE = "en-us"
DEFAULT_VOICE = "af_sarah"
DEFAULT_MODEL_PATH = "kokoro-v1.0.onnx"
DEFAULT_VOICES_PATH = "voices-v1.0.bin"


def check_required_files(model_path, voices_path):
    """Check if required model files exist."""
    missing = []
    if not os.path.exists(model_path):
        missing.append(f"Model file: {model_path}")
    if not os.path.exists(voices_path):
        missing.append(f"Voices file: {voices_path}")
    
    if missing:
        print("Error: Required files are missing:", file=sys.stderr)
        for item in missing:
            print(f"  • {item}", file=sys.stderr)
        print("\nDownload from:", file=sys.stderr)
        print("  wget https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx", file=sys.stderr)
        print("  wget https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin", file=sys.stderr)
        sys.exit(1)


def main():
    """Main entry point for the script"""
    parser = argparse.ArgumentParser(
        description="Kokoro TTS Generator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python kokoro_runner.py --text "Hello world" --output hello.wav
  python kokoro_runner.py --text "Custom voice" --output voice.wav --voice af_alloy
  python kokoro_runner.py --text "Fast speech" --output fast.wav --speed 1.5
  python kokoro_runner.py --text "Bonjour" --output french.wav --lang fr-fr --voice ff_siwis
        """
    )
    
    # Required arguments
    parser.add_argument("--text", required=True, type=str,
                       help="Text to convert to speech")
    parser.add_argument("--output", required=True, type=str,
                       help="Output WAV file path")
    
    # Optional generation parameters
    parser.add_argument("--speed", type=float, default=DEFAULT_SPEED,
                       help=f"Speech speed (0.5-2.0, default: {DEFAULT_SPEED})")
    parser.add_argument("--lang", type=str, default=DEFAULT_LANGUAGE,
                       help=f"Language code (default: {DEFAULT_LANGUAGE})")
    parser.add_argument("--voice", type=str, default=DEFAULT_VOICE,
                       help=f"Voice name (default: {DEFAULT_VOICE})")
    
    # Model paths
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL_PATH,
                       help=f"Path to kokoro ONNX model (default: {DEFAULT_MODEL_PATH})")
    parser.add_argument("--voices", type=str, default=DEFAULT_VOICES_PATH,
                       help=f"Path to voices bin file (default: {DEFAULT_VOICES_PATH})")
    
    args = parser.parse_args()
    
    # Validate arguments
    if not args.text.strip():
        print("Error: Text cannot be empty", file=sys.stderr)
        sys.exit(1)
    
    if args.speed < 0.5 or args.speed > 2.0:
        print("Error: Speed must be between 0.5 and 2.0", file=sys.stderr)
        sys.exit(1)
    
    # Check for required files
    check_required_files(args.model, args.voices)
    
    try:
        # Initialize Kokoro
        print("[MAIN] Initializing Kokoro TTS...", file=sys.stderr)
        print(f"[MAIN] Model: {args.model}", file=sys.stderr)
        print(f"[MAIN] Voices: {args.voices}", file=sys.stderr)
        
        kokoro = Kokoro(args.model, args.voices)
        
        # Generate speech
        print(f"[MAIN] Generating speech for: '{args.text}'", file=sys.stderr)
        print(f"[MAIN] Language: {args.lang}, Voice: {args.voice}, Speed: {args.speed}", file=sys.stderr)
        
        # Call Kokoro to generate audio
        samples, sample_rate = kokoro.create(
            text=args.text,
            voice=args.voice,
            speed=args.speed,
            lang=args.lang
        )
        
        if samples is None or len(samples) == 0:
            print("Error: No audio generated", file=sys.stderr)
            sys.exit(1)
        
        # Ensure output directory exists
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Write output file
        print(f"[MAIN] Writing output to: {args.output}", file=sys.stderr)
        sf.write(args.output, samples, sample_rate)
        
        duration = len(samples) / sample_rate
        print(f"[MAIN] Success! Audio saved to: {args.output}", file=sys.stderr)
        print(f"[MAIN] Duration: {duration:.2f}s, Sample rate: {sample_rate}Hz", file=sys.stderr)
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

