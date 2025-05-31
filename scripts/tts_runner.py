import argparse
import logging
import torch
import torchaudio as ta
import os
import tempfile
from chatterbox.tts import ChatterboxTTS

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Patch torch.load to use detected device by default
def patch_torch_load(device):
    original_torch_load = torch.load

    def patched_load(*args, **kwargs):
        if 'map_location' not in kwargs:
            kwargs['map_location'] = torch.device(device)
        return original_torch_load(*args, **kwargs)

    torch.load = patched_load

def main():
    parser = argparse.ArgumentParser(description='Chatterbox TTS Command Line')
    parser.add_argument('--text', type=str, required=True, help='Text to synthesize')
    parser.add_argument('--output', type=str, required=True, help='Output WAV file path')
    parser.add_argument('--reference_audio', type=str, help='Path to reference audio for voice cloning')
    parser.add_argument('--exaggeration', type=float, default=0.2, help='Voice style exaggeration')
    parser.add_argument('--cfg_weight', type=float, default=1.0, help='Configuration weight')

    args = parser.parse_args()

    # Validate input text
    if not args.text.strip():
        logger.error("Input text cannot be empty")
        return

    try:
        # Validate output path is within temporary directory
        temp_dir = tempfile.gettempdir()
        output_real = os.path.realpath(args.output)
        temp_real = os.path.realpath(temp_dir)

        # Check that output is strictly within temp dir and not a symlink
        if not output_real.startswith(temp_real + os.sep):
            logger.error(f"Output path {args.output} is not strictly within temporary directory")
            raise ValueError("Invalid output path")

        # Prevent symlink attacks: ensure output is not a symlink
        if os.path.islink(args.output):
            logger.error(f"Output path {args.output} is a symlink, which is not allowed")
            raise ValueError("Output path cannot be a symlink")

        try:
            if os.path.commonpath([output_real, temp_real]) != temp_real:
                logger.error(f"Output path {args.output} is not within temporary directory")
                raise ValueError("Invalid output path")
        except ValueError:
            # commonpath raises ValueError if paths are on different drives (Windows)
            logger.error(f"Output path {args.output} is not within temporary directory")
            raise ValueError("Invalid output path")

        # Detect available device
        device = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Using device: {device}")

        # Patch torch.load
        patch_torch_load(device)

        # Initialize Chatterbox
        logger.info('Initializing Chatterbox TTS')
        try:
            cb = ChatterboxTTS.from_pretrained(device=device)
        except Exception as e:
            logger.error(f'Error initializing ChatterboxTTS: {str(e)}')
            raise

        # Generate speech with parameters
        logger.info('Generating speech...')
        # Create parameters dictionary with only provided arguments
        wav = cb.generate(
            args.text,
            audio_prompt_path=args.reference_audio,
            exaggeration=args.exaggeration,
            cfg_weight=args.cfg_weight
        )
        logger.info('Speech generation complete')

        # Ensure audio tensor has correct dimensions [channels, samples]
        if wav.dim() == 1:
            wav = wav.unsqueeze(0)

        # Save to file
        logger.info(f'Saving audio to {args.output}')
        # Ensure audio tensor has correct dimensions (channels, samples)
        if wav.dim() == 1:
            wav = wav.unsqueeze(0)
        ta.save(args.output, wav, cb.sr)

        logger.info('Audio saved successfully')
    except Exception as e:
        logger.error(f'Error in TTS synthesis: {str(e)}')
        raise

if __name__ == '__main__':
    main()