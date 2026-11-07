// A short block of mono PCM keeps the audio thread independent of networking.
class JudeCapture extends AudioWorkletProcessor {
  constructor() { super(); this.block = new Int16Array(2400); this.used = 0; }
  process(inputs) {
    const data = inputs[0]?.[0];
    if (!data) return true;
    for (const sample of data) {
      this.block[this.used++] = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
      if (this.used === this.block.length) {
        this.port.postMessage(this.block.buffer, [this.block.buffer]);
        this.block = new Int16Array(2400); this.used = 0;
      }
    }
    return true;
  }
}
registerProcessor('jude-capture', JudeCapture);
