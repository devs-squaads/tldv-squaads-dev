/**
 * pcm-playback — AudioWorklet de reproducción.
 *
 * Recibe bloques de Float32 (PCM 24 kHz ya decodificado) y los entrega al
 * grafo en orden. `{ type: "flush" }` corta la cola: es el barge-in, cuando el
 * usuario interrumpe y hay que dejar de hablar de inmediato.
 */
class PcmPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queue = [];
    this._current = null;
    this._offset = 0;

    this.port.onmessage = (event) => {
      const data = event.data;

      if (data && data.type === "flush") {
        this._queue = [];
        this._current = null;
        this._offset = 0;
        return;
      }

      if (data && data.samples) {
        this._queue.push(data.samples);
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const frames = output[0].length;

    for (let i = 0; i < frames; i += 1) {
      if (!this._current || this._offset >= this._current.length) {
        this._current = this._queue.length > 0 ? this._queue.shift() : null;
        this._offset = 0;
      }

      const sample = this._current ? this._current[this._offset] : 0;
      this._offset += 1;

      for (let channel = 0; channel < output.length; channel += 1) {
        output[channel][i] = sample;
      }
    }

    return true;
  }
}

registerProcessor("pcm-playback", PcmPlaybackProcessor);
