/**
 * pcm-capture — AudioWorklet de captura de micrófono.
 *
 * Junta los render quanta del grafo y los publica en bloques de 2048 muestras
 * de Float32. El downsample a 16 kHz y el empaquetado PCM16/base64 los hace el
 * hilo principal con los módulos puros de `modules/chat/voice/pcm`.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(2048);
    this._offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i += 1) {
      this._buffer[this._offset] = channel[i];
      this._offset += 1;

      if (this._offset === this._buffer.length) {
        this.port.postMessage(this._buffer.slice(0));
        this._offset = 0;
      }
    }

    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
