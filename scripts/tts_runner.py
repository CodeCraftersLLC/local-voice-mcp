import argparse
import logging
import torch
import torchaudio as ta
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
    parser.add_argument('--voice', type=str, required=True, help='Voice model to use')
    parser.add_argument('--output', type=str, required=True, help='Output WAV file path')
    parser.add_argument('--pitch', type=float, default=1.0, help='Pitch adjustment (0.5-2.0)')
    parser.add_argument('--speed', type=float, default=1.0, help='Speed adjustment (0.5-2.0)')
    parser.add_argument('--emotion', type=str, default='neutral', help='Emotion preset')
    parser.add_argument('--exaggeration', type=float, default=2.0, help='Voice style exaggeration')
    parser.add_argument('--cfg_weight', type=float, default=0.5, help='Configuration weight')
    
    args = parser.parse_args()
    
    try:
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
        wav = cb.generate(
            args.text,
            exaggeration=args.exaggeration,
            cfg_weight=args.cfg_weight
        )
        logger.info('Speech generation complete')
        
        # Save to file
        logger.info(f'Saving audio to {args.output}')
        ta.save(args.output, wav, cb.sr)
        
        logger.info('Audio saved successfully')
    except Exception as e:
        logger.error(f'Error in TTS synthesis: {str(e)}')
        raise

if __name__ == '__main__':
    main()