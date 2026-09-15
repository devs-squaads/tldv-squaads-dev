/**
 * Conversión y framing de audio PCM para la voz en tiempo real.
 *
 * Módulo puro y sin dependencias: el cliente captura a 16 kHz
 * (`audio/pcm;rate=16000`) y reproduce a 24 kHz, tal como los entrega Gemini
 * Live. Todo pasa por acá para que el transporte WebSocket sea solo eso.
 */

const PCM16_MAX = 32767;
const PCM16_MIN = -32768;
const PCM16_SCALE = 32768;

export function float32ToPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    pcm[i] = clamped < 0 ? Math.round(clamped * PCM16_SCALE) : Math.round(clamped * PCM16_MAX);
  }

  return pcm;
}

export function pcm16ToFloat32(pcm: Int16Array): Float32Array {
  const samples = new Float32Array(pcm.length);

  for (let i = 0; i < pcm.length; i += 1) {
    samples[i] = (pcm[i] ?? 0) / PCM16_SCALE;
  }

  return samples;
}

/**
 * Downsample por promedio de ventana (no decimación): conserva la amplitud y
 * evita el aliasing grosero que produce quedarse con una muestra de cada N.
 */
export function downsampleTo16k(
  samples: Float32Array,
  inputRate: number,
  outputRate = 16000,
): Float32Array {
  if (inputRate <= outputRate || samples.length === 0) {
    return new Float32Array(samples);
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(samples.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));

    let sum = 0;
    for (let j = start; j < end; j += 1) {
      sum += samples[j] ?? 0;
    }
    output[i] = sum / (end - start);
  }

  return output;
}

function int16ToUnsigned(sample: number): number {
  return sample < 0 ? sample + 0x10000 : sample;
}

function bytesToBase64(bytes: Uint8Array): string {
  // Chunkeado: evita reventar el stack con audio largo.
  const CHUNK_SIZE = 0x2000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }

  return btoa(binary);
}

/** Serializa PCM16 little-endian a base64, el framing que espera Gemini Live. */
export function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.length * 2);

  for (let i = 0; i < pcm.length; i += 1) {
    const value = int16ToUnsigned(pcm[i] ?? 0);
    bytes[i * 2] = value & 0xff;
    bytes[i * 2 + 1] = (value >> 8) & 0xff;
  }

  return bytesToBase64(bytes);
}

export function base64ToPcm16(base64: string): Int16Array {
  const binary = atob(base64);
  const length = Math.floor(binary.length / 2);
  const pcm = new Int16Array(length);

  for (let i = 0; i < length; i += 1) {
    const unsigned = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
    pcm[i] = unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
  }

  return pcm;
}

export { PCM16_MAX, PCM16_MIN };
