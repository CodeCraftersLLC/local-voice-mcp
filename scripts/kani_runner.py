#!/usr/bin/env python3
"""
Kani TTS 2 Runner Script

This script provides a command-line interface to the Kani TTS 2 system.
It handles text input, generates speech using a HuggingFace-hosted model,
and outputs a WAV file. Supports voice cloning via speaker embeddings.

Usage:
    python kani_runner.py --text "Your text here" --output output.wav [options]
"""

import argparse
import sys
import os
import traceback
from pathlib import Path

# Import Kani TTS components
try:
    from kani_tts import KaniTTS, SpeakerEmbedder
    import soundfile as sf
except ImportError as e:
    print(f"Error: Required dependency not found: {e}", file=sys.stderr)
    print("Please install required packages:", file=sys.stderr)
    print("  pip install kani-tts-2 transformers==4.56.0 soundfile numpy", file=sys.stderr)
    sys.exit(1)

# Configuration constants
DEFAULT_MODEL = "nineninesix/kani-tts-2-en"
DEFAULT_TEMPERATURE = 1.0
DEFAULT_TOP_P = 0.95
DEFAULT_REPETITION_PENALTY = 1.1
SAMPLE_RATE = 22050


def main():
    """Main entry point for the script"""
    parser = argparse.ArgumentParser(
        description="Kani TTS 2 Generator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python kani_runner.py --text "Hello world" --output hello.wav
  python kani_runner.py --text "Clone voice" --output clone.wav --reference_audio ref.wav
  python kani_runner.py --text "Custom model" --output custom.wav --model nineninesix/other-model
  python kani_runner.py --text "Low temp" --output precise.wav --temperature 0.5
        """
    )

    # Required arguments
    parser.add_argument("--text", required=True, type=str,
                        help="Text to convert to speech")
    parser.add_argument("--output", required=True, type=str,
                        help="Output WAV file path")

    # Optional: voice cloning
    parser.add_argument("--reference_audio", type=str, default=None,
                        help="Path to reference audio file for voice cloning (3-30s recommended)")

    # Optional: model selection
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL,
                        help=f"HuggingFace model name (default: {DEFAULT_MODEL})")

    # Optional: generation parameters
    parser.add_argument("--temperature", type=float, default=DEFAULT_TEMPERATURE,
                        help=f"Sampling temperature 0.0-1.0 (default: {DEFAULT_TEMPERATURE})")
    parser.add_argument("--top_p", type=float, default=DEFAULT_TOP_P,
                        help=f"Top-p nucleus sampling (default: {DEFAULT_TOP_P})")
    parser.add_argument("--repetition_penalty", type=float, default=DEFAULT_REPETITION_PENALTY,
                        help=f"Repetition penalty (default: {DEFAULT_REPETITION_PENALTY})")

    # Optional: language tag
    parser.add_argument("--language_tag", type=str, default=None,
                        help="Language tag for generation (e.g., 'en')")

    args = parser.parse_args()

    # Validate arguments
    if not args.text.strip():
        print("Error: Text cannot be empty", file=sys.stderr)
        sys.exit(1)

    if args.temperature < 0.0 or args.temperature > 1.0:
        print("Error: Temperature must be between 0.0 and 1.0", file=sys.stderr)
        sys.exit(1)

    if args.top_p < 0.0 or args.top_p > 1.0:
        print("Error: top_p must be between 0.0 and 1.0", file=sys.stderr)
        sys.exit(1)

    if args.repetition_penalty < 1.0 or args.repetition_penalty > 2.0:
        print("Error: repetition_penalty must be between 1.0 and 2.0", file=sys.stderr)
        sys.exit(1)

    if args.reference_audio and not os.path.exists(args.reference_audio):
        print(f"Error: Reference audio file not found: {args.reference_audio}", file=sys.stderr)
        sys.exit(1)

    try:
        # Initialize Kani TTS model
        print(f"[MAIN] Initializing Kani TTS 2...", file=sys.stderr)
        print(f"[MAIN] Model: {args.model}", file=sys.stderr)

        model = KaniTTS(args.model)

        # Handle voice cloning via speaker embedding
        speaker_emb = None
        if args.reference_audio:
            print(f"[MAIN] Extracting speaker embedding from: {args.reference_audio}", file=sys.stderr)
            embedder = SpeakerEmbedder()
            speaker_emb = embedder.embed_audio_file(args.reference_audio)
            print(f"[MAIN] Speaker embedding extracted successfully", file=sys.stderr)

        # Build generation kwargs
        gen_kwargs = {
            "temperature": args.temperature,
            "top_p": args.top_p,
            "repetition_penalty": args.repetition_penalty,
        }

        if args.language_tag:
            gen_kwargs["language_tag"] = args.language_tag
        if speaker_emb is not None:
            gen_kwargs["speaker_emb"] = speaker_emb

        # Generate speech
        print(f"[MAIN] Generating speech for: '{args.text[:100]}...'", file=sys.stderr)
        print(f"[MAIN] Temperature: {args.temperature}, top_p: {args.top_p}, "
              f"rep_penalty: {args.repetition_penalty}", file=sys.stderr)

        audio, processed_text = model(args.text, **gen_kwargs)

        if audio is None or len(audio) == 0:
            print("Error: No audio generated", file=sys.stderr)
            sys.exit(1)

        # Ensure output directory exists
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Write output file
        print(f"[MAIN] Writing output to: {args.output}", file=sys.stderr)
        sf.write(args.output, audio, SAMPLE_RATE)

        duration = len(audio) / SAMPLE_RATE
        print(f"[MAIN] Success! Audio saved to: {args.output}", file=sys.stderr)
        print(f"[MAIN] Duration: {duration:.2f}s, Sample rate: {SAMPLE_RATE}Hz", file=sys.stderr)

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
