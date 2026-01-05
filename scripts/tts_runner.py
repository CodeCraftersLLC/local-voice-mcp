import argparse
import logging
import os
import platform
import tempfile
import shutil

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def detect_backend():
    """
    Auto-detect the optimal backend based on available hardware.

    Priority:
    1. MLX (Apple Silicon with mlx-audio installed)
    2. CUDA (NVIDIA GPU)
    3. MPS (Apple Silicon without MLX - fallback to PyTorch MPS)
    4. CPU (fallback)
    """
    # Check for Apple Silicon with MLX
    if platform.system() == "Darwin" and platform.processor() == "arm":
        try:
            import mlx.core
            logger.info("MLX detected - using mlx-audio backend for Apple Silicon")
            return "mlx"
        except ImportError:
            logger.info("MLX not installed, checking for PyTorch MPS")

    # Import torch for CUDA/MPS/CPU detection
    try:
        import torch
    except ImportError:
        logger.warning("PyTorch not installed, falling back to CPU mode")
        return "cpu"

    # Check for CUDA
    if torch.cuda.is_available():
        logger.info("CUDA detected - using PyTorch CUDA backend")
        return "cuda"

    # Check for MPS (Apple Silicon without MLX)
    if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
        logger.info("MPS detected - using PyTorch MPS backend")
        return "mps"

    logger.info("No GPU detected - using CPU backend (this will be slow)")
    return "cpu"


def generate_with_mlx(text, output_path, ref_audio=None):
    """Generate audio using MLX backend (Apple Silicon optimized)."""
    from mlx_audio.tts.generate import generate_audio

    logger.info("Generating audio with MLX backend (chatterbox-turbo-6bit)")

    # Get output directory and base name
    output_dir = os.path.dirname(output_path)
    output_basename = os.path.basename(output_path).replace(".wav", "")

    # Save the current working directory
    original_cwd = os.getcwd()

    try:
        # Change to output directory so mlx_audio saves there
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
            os.chdir(output_dir)

        # Generate audio - mlx_audio saves files in current directory with pattern {prefix}_000.wav
        generate_audio(
            text=text,
            model="mlx-community/chatterbox-turbo-6bit",
            ref_audio=ref_audio,
            file_prefix=output_basename,
            audio_format="wav",
            join_audio=True,
            verbose=True
        )

        # mlx_audio saves with _000 suffix in current directory
        mlx_output_file = f"{output_basename}_000.wav"
        mlx_output_alt = f"{output_basename}.wav"

        # Find the generated file and rename to expected output
        if os.path.exists(mlx_output_file):
            shutil.move(mlx_output_file, output_path)
            logger.info(f"Moved output from {mlx_output_file} to {output_path}")
        elif os.path.exists(mlx_output_alt):
            shutil.move(mlx_output_alt, output_path)
            logger.info(f"Moved output from {mlx_output_alt} to {output_path}")
        else:
            raise FileNotFoundError(f"MLX audio output not found at {mlx_output_file} or {mlx_output_alt}")

    finally:
        # Restore original working directory
        os.chdir(original_cwd)


def generate_with_pytorch(text, output_path, ref_audio=None, device="cuda"):
    """Generate audio using PyTorch backend (CUDA/MPS/CPU)."""
    import torch
    import torchaudio as ta
    from chatterbox.tts_turbo import ChatterboxTurboTTS

    logger.info(f"Generating audio with PyTorch backend on device: {device}")

    # Patch torch.load to use the correct device
    original_torch_load = torch.load

    def patched_load(*args, **kwargs):
        if 'map_location' not in kwargs:
            kwargs['map_location'] = torch.device(device)
        return original_torch_load(*args, **kwargs)

    torch.load = patched_load

    try:
        # Initialize Chatterbox Turbo
        logger.info('Initializing ChatterboxTurbo TTS')
        model = ChatterboxTurboTTS.from_pretrained(device=device)

        # Generate speech
        logger.info('Generating speech...')
        wav = model.generate(text, audio_prompt_path=ref_audio)
        logger.info('Speech generation complete')

        # Ensure audio tensor has correct dimensions [channels, samples]
        if wav.dim() == 1:
            wav = wav.unsqueeze(0)

        # Save to file
        logger.info(f'Saving audio to {output_path}')
        ta.save(output_path, wav, model.sr)
        logger.info('Audio saved successfully')
    finally:
        # Restore original torch.load
        torch.load = original_torch_load


def validate_output_path(output_path):
    """Validate that output path is within an allowed temporary directory."""
    output_real = os.path.realpath(output_path)

    # Prevent symlink attacks: ensure output is not a symlink
    if os.path.islink(output_path):
        logger.error(f"Output path {output_path} is a symlink, which is not allowed")
        raise ValueError("Output path cannot be a symlink")

    # Get allowed temporary directories
    allowed_temp_dirs = []

    # User-specific temp directory (e.g., /var/folders/.../T on macOS)
    user_temp = os.path.realpath(tempfile.gettempdir())
    allowed_temp_dirs.append(user_temp)

    # Standard /tmp directory (common on Unix systems)
    if os.path.exists("/tmp"):
        allowed_temp_dirs.append(os.path.realpath("/tmp"))

    # Check if output is within any allowed temp directory
    is_valid = False
    for temp_dir in allowed_temp_dirs:
        if output_real.startswith(temp_dir + os.sep) or output_real == temp_dir:
            is_valid = True
            break
        try:
            if os.path.commonpath([output_real, temp_dir]) == temp_dir:
                is_valid = True
                break
        except ValueError:
            # commonpath raises ValueError if paths are on different drives (Windows)
            continue

    if not is_valid:
        logger.error(f"Output path {output_path} is not within any allowed temporary directory")
        logger.error(f"Allowed directories: {allowed_temp_dirs}")
        raise ValueError("Invalid output path")


def main():
    parser = argparse.ArgumentParser(description='Chatterbox Turbo TTS Command Line')
    parser.add_argument('--text', type=str, required=True, help='Text to synthesize')
    parser.add_argument('--output', type=str, required=True, help='Output WAV file path')
    parser.add_argument('--reference_audio', type=str, help='Path to reference audio for voice cloning')

    args = parser.parse_args()

    # Validate input text
    if not args.text.strip():
        logger.error("Input text cannot be empty")
        return

    try:
        # Validate output path security
        validate_output_path(args.output)

        # Detect the best backend
        backend = detect_backend()

        if backend == "mlx":
            generate_with_mlx(
                text=args.text,
                output_path=args.output,
                ref_audio=args.reference_audio
            )
        else:
            # Use PyTorch for cuda, mps, or cpu
            generate_with_pytorch(
                text=args.text,
                output_path=args.output,
                ref_audio=args.reference_audio,
                device=backend
            )

        logger.info('TTS synthesis completed successfully')

    except Exception as e:
        logger.error(f'Error in TTS synthesis: {str(e)}')
        raise


if __name__ == '__main__':
    main()
