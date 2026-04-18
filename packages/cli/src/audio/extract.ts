import { execFileSync } from "node:child_process";

export interface AudioAnalysisFrame {
  time: number;
  rms: number;
  bands: number[];
}

export interface AudioAnalysisData {
  duration: number;
  fps: number;
  bands: number;
  totalFrames: number;
  frames: AudioAnalysisFrame[];
}

const SAMPLE_RATE = 44_100;
const FFT_SIZE = 4096;
const MIN_FREQ = 30;
const MAX_FREQ = 16_000;
const BYTES_PER_SAMPLE = 2;

let cachedHannWindow: Float32Array | null = null;

function getHannWindow(size: number): Float32Array {
  if (cachedHannWindow && cachedHannWindow.length === size) return cachedHannWindow;
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  cachedHannWindow = window;
  return window;
}

export function decodeAudioToMono(path: string, sampleRate = SAMPLE_RATE): Float32Array {
  try {
    const stdout = execFileSync(
      "ffmpeg",
      [
        "-i",
        path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        String(sampleRate),
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        "-loglevel",
        "error",
        "pipe:1",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      },
    );

    const sampleCount = Math.floor(stdout.byteLength / BYTES_PER_SAMPLE);
    const pcm = new Int16Array(stdout.buffer, stdout.byteOffset, sampleCount);
    const samples = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      samples[i] = (pcm[i] ?? 0) / 32768;
    }
    return samples;
  } catch (error) {
    const message =
      error instanceof Error && "stderr" in error && typeof error.stderr?.toString === "function"
        ? error.stderr.toString().trim() || error.message
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(`Failed to decode audio with ffmpeg: ${message}`);
  }
}

export function computeBandEdges(nBands: number): number[] {
  const edges: number[] = [];
  for (let i = 0; i <= nBands; i++) {
    edges.push(MIN_FREQ * (MAX_FREQ / MIN_FREQ) ** (i / nBands));
  }
  return edges;
}

function reverseBits(value: number, bits: number): number {
  let reversed = 0;
  for (let i = 0; i < bits; i++) {
    reversed = (reversed << 1) | (value & 1);
    value >>>= 1;
  }
  return reversed;
}

function fftInPlace(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  const levels = Math.log2(n);
  if (!Number.isInteger(levels)) {
    throw new Error(`FFT size must be a power of two, received ${n}`);
  }

  for (let i = 0; i < n; i++) {
    const j = reverseBits(i, levels);
    if (j <= i) continue;
    const realValue = real[i] ?? 0;
    const imagValue = imag[i] ?? 0;
    real[i] = real[j] ?? 0;
    imag[i] = imag[j] ?? 0;
    real[j] = realValue;
    imag[j] = imagValue;
  }

  for (let size = 2; size <= n; size <<= 1) {
    const halfSize = size >>> 1;
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let offset = 0; offset < halfSize; offset++) {
        const evenIndex = start + offset;
        const oddIndex = evenIndex + halfSize;
        const angle = step * offset;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const oddReal = real[oddIndex] ?? 0;
        const oddImag = imag[oddIndex] ?? 0;
        const twiddledReal = oddReal * cos - oddImag * sin;
        const twiddledImag = oddReal * sin + oddImag * cos;

        const evenReal = real[evenIndex] ?? 0;
        const evenImag = imag[evenIndex] ?? 0;
        real[oddIndex] = evenReal - twiddledReal;
        imag[oddIndex] = evenImag - twiddledImag;
        real[evenIndex] = evenReal + twiddledReal;
        imag[evenIndex] = evenImag + twiddledImag;
      }
    }
  }
}

function computeMagnitudes(windowed: Float32Array): Float32Array {
  const real = windowed.slice();
  const imag = new Float32Array(windowed.length);
  fftInPlace(real, imag);

  const half = (windowed.length >>> 1) + 1;
  const magnitudes = new Float32Array(half);
  for (let i = 0; i < half; i++) {
    magnitudes[i] = Math.hypot(real[i] ?? 0, imag[i] ?? 0);
  }
  return magnitudes;
}

function computeFftBands(
  windowed: Float32Array,
  freqPerBin: number,
  nBins: number,
  bandEdges: number[],
  nBands: number,
): Float32Array {
  const magnitudes = computeMagnitudes(windowed);
  const bands = new Float32Array(nBands);

  for (let bandIndex = 0; bandIndex < nBands; bandIndex++) {
    let lowBin = Math.max(0, Math.floor((bandEdges[bandIndex] ?? 0) / freqPerBin));
    let highBin = Math.min(nBins, Math.floor((bandEdges[bandIndex + 1] ?? MAX_FREQ) / freqPerBin));
    if (highBin <= lowBin) highBin = lowBin + 1;
    lowBin = Math.min(lowBin, nBins - 1);
    highBin = Math.min(highBin, nBins);

    let peak = 0;
    for (let i = lowBin; i < highBin; i++) {
      peak = Math.max(peak, magnitudes[i] ?? 0);
    }
    bands[bandIndex] = peak;
  }

  return bands;
}

function computeRms(samples: Float32Array, start: number, end: number): number {
  let sumSquares = 0;
  let count = 0;
  for (let i = start; i < end && i < samples.length; i++) {
    const sample = samples[i] ?? 0;
    sumSquares += sample * sample;
    count++;
  }
  return count > 0 ? Math.sqrt(sumSquares / count) : 0;
}

function buildWindow(samples: Float32Array, center: number, size: number): Float32Array {
  const halfSize = size >>> 1;
  const start = center - halfSize;
  const end = center + halfSize;
  const window = new Float32Array(size);
  const sourceStart = Math.max(0, start);
  const sourceEnd = Math.min(samples.length, end);
  const destinationStart = sourceStart - start;
  window.set(samples.subarray(sourceStart, sourceEnd), destinationStart);

  const hann = getHannWindow(size);
  for (let i = 0; i < size; i++) {
    window[i] = (window[i] ?? 0) * (hann[i] ?? 0);
  }
  return window;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function analyzeAudioSamples(
  samples: Float32Array,
  fps: number,
  nBands: number,
  sampleRate = SAMPLE_RATE,
): AudioAnalysisData {
  const duration = samples.length / sampleRate;
  const frameStep = Math.floor(sampleRate / fps);
  const totalFrames = Math.floor(duration * fps);
  const bandEdges = computeBandEdges(nBands);
  const nBins = (FFT_SIZE >>> 1) + 1;
  const freqPerBin = sampleRate / FFT_SIZE;

  const rmsValues = new Float32Array(totalFrames);
  // Explicit `Float32Array[]` — avoids a TS 5.7+ variance error where the
  // inferred type from `Array.from(..., () => new Float32Array(n))` narrows
  // the buffer type parameter and clashes with the `Float32Array` returned
  // from `computeFftBands` at line 241.
  const bandValues: Float32Array[] = Array.from(
    { length: totalFrames },
    () => new Float32Array(nBands),
  );
  const bandPeaks = new Float32Array(nBands);
  let peakRms = 0;

  for (let frame = 0; frame < totalFrames; frame++) {
    const rmsStart = frame * frameStep;
    const rmsEnd = rmsStart + frameStep;
    const rms = computeRms(samples, rmsStart, rmsEnd);
    rmsValues[frame] = rms;
    peakRms = Math.max(peakRms, rms);

    const center = rmsStart + Math.floor(frameStep / 2);
    const window = buildWindow(samples, center, FFT_SIZE);
    const bands = computeFftBands(window, freqPerBin, nBins, bandEdges, nBands);
    bandValues[frame] = bands;
    for (let bandIndex = 0; bandIndex < nBands; bandIndex++) {
      bandPeaks[bandIndex] = Math.max(bandPeaks[bandIndex] ?? 0, bands[bandIndex] ?? 0);
    }
  }

  const frames: AudioAnalysisFrame[] = [];
  for (let frame = 0; frame < totalFrames; frame++) {
    const normalizedRms = peakRms > 0 ? (rmsValues[frame] ?? 0) / peakRms : 0;
    const normalizedBands = Array.from({ length: nBands }, (_, bandIndex) => {
      const peak = bandPeaks[bandIndex] ?? 0;
      return round4(peak > 0 ? (bandValues[frame]?.[bandIndex] ?? 0) / peak : 0);
    });

    frames.push({
      time: round4(frame / fps),
      rms: round4(normalizedRms),
      bands: normalizedBands,
    });
  }

  return {
    duration: round4(duration),
    fps,
    bands: nBands,
    totalFrames,
    frames,
  };
}

export function extractAudioAnalysis(path: string, fps: number, nBands: number): AudioAnalysisData {
  const samples = decodeAudioToMono(path);
  return analyzeAudioSamples(samples, fps, nBands);
}
