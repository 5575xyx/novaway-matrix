declare const registerProcessor: (name: string, processor: new () => AudioWorkletProcessor) => void
// AudioContext may ignore the requested 16 kHz rate. Resample explicitly so
// Whisper always receives the expected 16 kHz PCM stream.
declare const sampleRate: number

declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

class NovaWayVoiceCapture extends AudioWorkletProcessor {
  private source: number[] = []
  private output: number[] = []
  private phase = 0
  private levelSum = 0
  private levelSamples = 0
  private readonly step = sampleRate / 16_000

  process(inputs: Float32Array[][]) {
    const input = inputs[0]?.[0]
    if (!input?.length) return true
    for (const sample of input) {
      this.source.push(sample)
      this.levelSum += sample * sample
      this.levelSamples += 1
    }
    if (this.levelSamples >= 2_400) {
      this.port.postMessage({ type: "level", level: Math.sqrt(this.levelSum / this.levelSamples) })
      this.levelSum = 0
      this.levelSamples = 0
    }

    while (this.phase + 1 < this.source.length) {
      const left = Math.floor(this.phase)
      const fraction = this.phase - left
      this.output.push(this.source[left]! * (1 - fraction) + this.source[left + 1]! * fraction)
      this.phase += this.step
    }
    const consumed = Math.floor(this.phase)
    if (consumed > 0) {
      this.source.splice(0, consumed)
      this.phase -= consumed
    }
    while (this.output.length >= 1600) {
      const chunk = new Float32Array(this.output.splice(0, 1600))
      this.port.postMessage({ type: "audio", pcm: chunk.buffer }, [chunk.buffer])
    }
    return true
  }
}

registerProcessor("novaway-voice-capture", NovaWayVoiceCapture)
