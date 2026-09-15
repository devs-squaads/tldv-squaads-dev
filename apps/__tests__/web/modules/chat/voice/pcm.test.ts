/// <reference types="bun" />

import { describe, expect, it } from "bun:test";

import {
  base64ToPcm16,
  downsampleTo16k,
  float32ToPcm16,
  pcm16ToBase64,
  pcm16ToFloat32,
} from "../../../../../web/src/modules/chat/voice/pcm";

describe("downsampleTo16k", () => {
  it("baja de 48 kHz a 16 kHz conservando longitud proporcional", () => {
    const input = new Float32Array(4800); // 100 ms a 48 kHz
    const output = downsampleTo16k(input, 48000);

    expect(output.length).toBe(1600); // 100 ms a 16 kHz
  });

  it("conserva la amplitud de una señal constante", () => {
    const input = new Float32Array(480).fill(0.5);
    const output = downsampleTo16k(input, 48000);

    expect(output.length).toBe(160);
    for (const sample of output) {
      expect(sample).toBeCloseTo(0.5, 5);
    }
  });

  it("promedia la ventana en vez de decimar", () => {
    // Ventana de 3 muestras: [0, 0, 3] → promedio 1
    const input = new Float32Array([0, 0, 3, 0, 0, 3]);
    const output = downsampleTo16k(input, 48000);

    expect(Array.from(output)).toEqual([1, 1]);
  });

  it("devuelve copia si la tasa de entrada ya es 16 kHz", () => {
    const input = new Float32Array([0.25, -0.25]);
    const output = downsampleTo16k(input, 16000);

    expect(Array.from(output)).toEqual([0.25, -0.25]);
  });
});

describe("float32ToPcm16 / pcm16ToFloat32", () => {
  it("hace ida y vuelta conservando la señal", () => {
    const input = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const pcm = float32ToPcm16(input);
    const roundTrip = pcm16ToFloat32(pcm);

    expect(pcm.length).toBe(input.length);
    for (let i = 0; i < input.length; i += 1) {
      expect(roundTrip[i]).toBeCloseTo(input[i] ?? 0, 3);
    }
  });

  it("clipea valores fuera de rango en vez de desbordar", () => {
    const pcm = float32ToPcm16(new Float32Array([2, -2]));

    expect(pcm[0]).toBe(32767);
    expect(pcm[1]).toBe(-32768);
  });
});

describe("pcm16ToBase64 / base64ToPcm16", () => {
  it("produce base64 con framing little-endian de 2 bytes por muestra", () => {
    const pcm = new Int16Array([0, 1, -1, 256]);
    const base64 = pcm16ToBase64(pcm);

    const decoded = Buffer.from(base64, "base64");
    expect(decoded.length).toBe(pcm.length * 2);
    expect(decoded[0]).toBe(0x00);
    expect(decoded[1]).toBe(0x00);
    expect(decoded[2]).toBe(0x01);
    expect(decoded[3]).toBe(0x00);
    expect(decoded[4]).toBe(0xff);
    expect(decoded[5]).toBe(0xff);
    expect(decoded[6]).toBe(0x00);
    expect(decoded[7]).toBe(0x01);
  });

  it("hace ida y vuelta base64 → PCM16", () => {
    const pcm = new Int16Array([-1234, 0, 1234, 32767, -32768]);
    const roundTrip = base64ToPcm16(pcm16ToBase64(pcm));

    expect(Array.from(roundTrip)).toEqual(Array.from(pcm));
  });
});
