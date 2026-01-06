import argparse
import glob
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
    # Use platform.machine() which reliably returns "arm64" on Apple Silicon
    if platform.system() == "Darwin" and platform.machine() in ("arm64", "aarch64"):
        try:
            import mlx.core
            import mlx_audio  # Also verify mlx_audio is available
            logger.info("MLX detected - using mlx-audio backend for Apple Silicon")
            return "mlx"
        except ImportError as e:
            logger.info(f"MLX or mlx_audio not installed ({e}), checking for PyTorch MPS")

    # Import torch for CUDA/MPS/CPU detection
    try:
        import torch
    except ImportError:
        logger.error(
            "PyTorch is not installed. PyTorch is required for CUDA, MPS, and CPU backends. "
            "Please install PyTorch or mlx-audio (for Apple Silicon) to use this TTS script."
        )
        raise RuntimeError("PyTorch is required but not installed. Install with: pip install torch torchaudio")

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

    # Convert to absolute path before any directory changes to avoid path issues
    output_path = os.path.abspath(output_path)

    # Validate output path is within allowed temp directory (security check)
    base_temp = os.path.realpath(tempfile.gettempdir())
    output_real = os.path.realpath(os.path.dirname(output_path))

    # Ensure output directory is within temp directory
    try:
        if os.path.commonpath([output_real, base_temp]) != base_temp:
            raise ValueError(f"Output path must reside within the system temporary directory: {base_temp}")
    except ValueError as e:
        if "different drives" not in str(e).lower():
            raise
        # On Windows, paths may be on different drives
        if not output_real.startswith(base_temp):
            raise ValueError(f"Output path must reside within the system temporary directory: {base_temp}")

    # Get output directory and base name
    output_dir = os.path.dirname(output_path)
    output_basename = os.path.basename(output_path).replace(".wav", "")

    # Save the current working directory
    original_cwd = os.getcwd()

    # Use an isolated temporary working directory for generation
    safe_work_dir = tempfile.mkdtemp(prefix="mlx_audio_", dir=base_temp)

    try:
        # Change to safe working directory
        os.chdir(safe_work_dir)

        # Ensure output directory exists
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)

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

        # Find the generated file using glob pattern (more robust than hardcoded names)
        generated_files = glob.glob(f"{output_basename}*.wav")

        if not generated_files:
            raise FileNotFoundError(
                f"MLX audio output not found with prefix '{output_basename}' in {safe_work_dir}"
            )

        # With join_audio=True, we expect one file
        generated_file = generated_files[0]
        src_abs = os.path.join(safe_work_dir, generated_file)

        # Security check: ensure destination is not a symlink
        if os.path.exists(output_path) and os.path.islink(output_path):
            raise ValueError("Destination path is a symlink; refusing to overwrite")

        # Check if source and destination are different before moving
        if os.path.abspath(src_abs) != os.path.abspath(output_path):
            shutil.move(src_abs, output_path)
            logger.info(f"Moved output from {generated_file} to {output_path}")
        else:
            logger.info(f"Output file already at correct location: {output_path}")

    finally:
        # Restore original working directory
        os.chdir(original_cwd)
        # Clean up temporary working directory
        try:
            shutil.rmtree(safe_work_dir)
        except Exception as e:
            logger.warning(f"Failed to clean up temp directory {safe_work_dir}: {e}")


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
    # Get allowed temporary directories
    allowed_temp_dirs = []

    # User-specific temp directory (e.g., /var/folders/.../T on macOS)
    user_temp = os.path.realpath(tempfile.gettempdir())
    allowed_temp_dirs.append(user_temp)

    # Standard /tmp directory (common on Unix systems)
    if os.path.exists("/tmp"):
        allowed_temp_dirs.append(os.path.realpath("/tmp"))

    # Resolve the output path to handle symlinks
    output_real = os.path.realpath(output_path)

    # Check if output is within any allowed temp directory
    is_valid = False
    matched_temp_dir = None
    for temp_dir in allowed_temp_dirs:
        if output_real.startswith(temp_dir + os.sep) or output_real == temp_dir:
            is_valid = True
            matched_temp_dir = temp_dir
            break
        try:
            if os.path.commonpath([output_real, temp_dir]) == temp_dir:
                is_valid = True
                matched_temp_dir = temp_dir
                break
        except ValueError:
            # commonpath raises ValueError if paths are on different drives (Windows)
            continue

    if not is_valid:
        logger.error(f"Output path {output_path} is not within any allowed temporary directory")
        logger.error(f"Allowed directories: {allowed_temp_dirs}")
        raise ValueError("Invalid output path")

    # Check for symlinks in path components between temp dir and output
    # This prevents symlink attacks where a directory component is a symlink
    if matched_temp_dir:
        rel_path = os.path.relpath(output_real, matched_temp_dir)
        if not rel_path.startswith(".."):
            current = matched_temp_dir
            for part in rel_path.split(os.sep):
                if not part or part == ".":
                    continue
                current = os.path.join(current, part)
                # Only check existing path components
                if os.path.exists(current) and os.path.islink(current):
                    logger.error(f"Path component {current} is a symlink, which is not allowed")
                    raise ValueError(f"Path contains symlinked component: {current}")


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
