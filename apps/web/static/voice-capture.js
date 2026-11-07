// One transferable, 100 ms block at 24 kHz. The worklet never sends audio to the playback output.
class JudeCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Int16Array(2400);
    this.used = 0;
    this.paused = false;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'resume') {
        this.paused = false;
      } else if (data.type === 'pause') {
        this.paused = true;
        if (this.used) this.emitBlock();
        if (data.boundary !== undefined) this.port.postMessage({ boundary: data.boundary });
      }
    };
  }

  emitBlock() {
    const pcm = this.used === this.block.length ? this.block : this.block.slice(0, this.used);
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    this.block = new Int16Array(2400);
    this.used = 0;
  }

  process(inputs) {
    const data = inputs[0]?.[0];
    if (!data || this.paused) return true;
    for (const sample of data) {
      this.block[this.used++] = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
      if (this.used === this.block.length) this.emitBlock();
    }
    return true;
  }
}
registerProcessor('jude-capture', JudeCapture);
