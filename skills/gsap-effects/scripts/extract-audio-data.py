#!/usr/bin/env python3
"""
Extract per-frame audio visualization data from an audio or video file.

Outputs JSON with RMS amplitude and frequency band data at the target FPS,
ready to embed in a HyperFrames composition.

Usage:
    python extract-audio-data.py input.mp3 -o audio-data.json
    python extract-audio-data.py input.mp4 --fps 30 --bands 16 -o audio-data.json

Requirements:
    - Python 3.9+
    - ffmpeg (for decoding audio)
    - numpy (pip install numpy — optional but 100x faster)
"""

import argparse
import json
import subprocess
import struct
import sys
import math

# ---------------------------------------------------------------------------
# FFT parameters
#
# The FFT window must be large enough to resolve low-frequency bands cleanly.
# At 44100Hz, a 4096-sample window gives ~10.8 Hz per bin — enough to
# distinguish 30Hz bass from 45Hz sub-bass. The per-frame audio slice
# (44100/30 = 1470 samples at 30fps) is far too small and causes the lowest
# bands to map to the same FFT bins, producing duplicate values.
#
# The window is centered on each frame's timestamp and zero-padded if it
# extends beyond the audio boundaries.
# ---------------------------------------------------------------------------

FFT_SIZE = 4096

# Frequency range for music: 30Hz–16kHz. Below 30Hz is sub-bass rumble that
# most speakers can't reproduce. Above 16kHz is noise/harmonics that don't
# contribute to perceived rhythm or melody.
MIN_FREQ = 30.0
MAX_FREQ = 16000.0


def decode_audio(path: str, sample_rate: int = 44100) -> tuple[bytes, int]:
    """Decode audio to raw PCM s16le mono via ffmpeg."""
    cmd = [
        "ffmpeg", "-i", path,
        "-vn", "-ac", "1", "-ar", str(sample_rate),
        "-f", "s16le", "-acodec", "pcm_s16le",
        "-loglevel", "error",
        "pipe:1",
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        print(f"ffmpeg error: {result.stderr.decode()}", file=sys.stderr)
        sys.exit(1)
    return result.stdout, sample_rate


def pcm_to_floats(pcm: bytes) -> list[float]:
    """Convert raw PCM s16le bytes to float samples in [-1, 1]."""
    n_samples = len(pcm) // 2
    samples = struct.unpack(f"<{n_samples}h", pcm[:n_samples * 2])
    return [s / 32768.0 for s in samples]


def compute_rms(samples: list[float]) -> float:
    """RMS amplitude of a frame."""
    if not samples:
        return 0.0
    return math.sqrt(sum(s * s for s in samples) / len(samples))


def get_fft_window(samples: list[float], center: int, fft_size: int) -> list[float]:
    """Extract a window of samples centered on `center`, zero-padded at edges."""
    half = fft_size // 2
    start = center - half
    end = center + half
    n = len(samples)

    window = []
    for i in range(start, end):
        if 0 <= i < n:
            window.append(samples[i])
        else:
            window.append(0.0)

    # Apply Hann window
    for i in range(len(window)):
        window[i] *= 0.5 - 0.5 * math.cos(2 * math.pi * i / len(window))

    return window


def compute_fft_bands(windowed: list[float], sample_rate: int, n_bands: int) -> list[float]:
    """Compute magnitude in logarithmically-spaced frequency bands via FFT."""
    n = len(windowed)
    if n == 0:
        return [0.0] * n_bands

    try:
        import numpy as np
        fft = np.fft.rfft(windowed)
        magnitudes = np.abs(fft).tolist()
    except ImportError:
        half = n // 2 + 1
        magnitudes = []
        for k in range(half):
            re = sum(windowed[i] * math.cos(2 * math.pi * k * i / n) for i in range(n))
            im = sum(windowed[i] * math.sin(2 * math.pi * k * i / n) for i in range(n))
            magnitudes.append(math.sqrt(re * re + im * im))

    freq_per_bin = sample_rate / n
    n_bins = len(magnitudes)

    # Logarithmic band edges from MIN_FREQ to MAX_FREQ
    band_edges = [MIN_FREQ * (MAX_FREQ / MIN_FREQ) ** (i / n_bands) for i in range(n_bands + 1)]

    bands = []
    for b in range(n_bands):
        low_bin = max(0, int(band_edges[b] / freq_per_bin))
        high_bin = min(n_bins - 1, int(band_edges[b + 1] / freq_per_bin))
        if high_bin <= low_bin:
            high_bin = low_bin + 1
        # Use max magnitude in the band (peak), not average — peaks are more
        # perceptually relevant and make the visualization more responsive.
        band_mag = max(magnitudes[low_bin:high_bin])
        bands.append(band_mag)

    return bands


def extract(path: str, fps: int, n_bands: int) -> dict:
    """Extract per-frame audio data."""
    print(f"Decoding audio from {path}...", file=sys.stderr)
    pcm, sample_rate = decode_audio(path)
    samples = pcm_to_floats(pcm)
    duration = len(samples) / sample_rate
    frame_step = sample_rate // fps
    total_frames = int(duration * fps)

    print(f"Duration: {duration:.1f}s, {total_frames} frames at {fps}fps", file=sys.stderr)
    print(f"FFT window: {FFT_SIZE} samples ({sample_rate/FFT_SIZE:.1f} Hz/bin)", file=sys.stderr)
    print(f"Frequency range: {MIN_FREQ:.0f}-{MAX_FREQ:.0f} Hz, {n_bands} bands", file=sys.stderr)

    # Pass 1: extract raw values
    raw_frames = []
    for f in range(total_frames):
        center = f * frame_step + frame_step // 2
        rms_start = f * frame_step
        rms_end = rms_start + frame_step
        frame_samples = samples[rms_start:rms_end]

        rms = compute_rms(frame_samples)
        window = get_fft_window(samples, center, FFT_SIZE)
        bands = compute_fft_bands(window, sample_rate, n_bands)

        raw_frames.append({"rms": rms, "bands": bands})

    # Pass 2: normalize RMS to 0-1 across the whole track
    peak_rms = max(f["rms"] for f in raw_frames) if raw_frames else 1.0

    # Pass 2b: normalize each band independently across the whole track.
    # This ensures that treble activity shows up even when bass is louder
    # in absolute terms. Without this, high bands look dead because their
    # absolute magnitudes are much smaller than bass/mid.
    band_peaks = [0.0] * n_bands
    for f in raw_frames:
        for i, b in enumerate(f["bands"]):
            if b > band_peaks[i]:
                band_peaks[i] = b

    # Build output
    frames = []
    for f_idx, raw in enumerate(raw_frames):
        rms = raw["rms"] / peak_rms if peak_rms > 0 else 0.0
        bands = []
        for i, b in enumerate(raw["bands"]):
            if band_peaks[i] > 0:
                bands.append(round(b / band_peaks[i], 4))
            else:
                bands.append(0.0)

        frames.append({
            "time": round(f_idx / fps, 4),
            "rms": round(rms, 4),
            "bands": bands,
        })

    return {
        "duration": round(duration, 4),
        "fps": fps,
        "bands": n_bands,
        "totalFrames": total_frames,
        "frames": frames,
    }


def main():
    parser = argparse.ArgumentParser(description="Extract per-frame audio visualization data")
    parser.add_argument("input", help="Audio or video file")
    parser.add_argument("-o", "--output", default="audio-data.json", help="Output JSON path")
    parser.add_argument("--fps", type=int, default=30, help="Frames per second (default: 30)")
    parser.add_argument("--bands", type=int, default=16, help="Number of frequency bands (default: 16)")
    args = parser.parse_args()

    data = extract(args.input, args.fps, args.bands)

    with open(args.output, "w") as f:
        json.dump(data, f)

    print(f"Wrote {args.output} ({data['totalFrames']} frames, {data['bands']} bands)", file=sys.stderr)


if __name__ == "__main__":
    main()
