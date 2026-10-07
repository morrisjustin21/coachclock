import { useRef, useState, useCallback, useEffect } from 'react'

// Runs on the audio thread, checking every ~3ms for a sudden loud spike
const WORKLET = `
class GunDetector extends AudioWorkletProcessor {
  constructor() {
    super();
    this.threshold = 0.4;
    this.baseline = 0.005;
    this.frames = 0;
    this.peakHold = 0;
    this.fired = false;
    this.port.onmessage = (e) => {
      if (e.data.threshold !== undefined) this.threshold = e.data.threshold;
    };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let peak = 0;
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
    }
    if (!this.fired && peak > this.threshold && peak > this.baseline * 8) {
      this.fired = true;
      this.port.postMessage({ type: 'trigger', time: currentTime });
    }
    this.baseline = this.baseline * 0.999 + peak * 0.001;
    this.peakHold = Math.max(this.peakHold, peak);
    this.frames++;
    if (this.frames % 16 === 0) {
      this.port.postMessage({ type: 'level', level: this.peakHold });
      this.peakHold = 0;
    }
    return true;
  }
}
registerProcessor('gun-detector', GunDetector);
`

export function useGunStart(onStart) {
  const [armed, setArmed] = useState(false)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState(null)
  const [threshold, setThreshold] = useState(0.4)
  const ref = useRef({})
  const onStartRef = useRef(onStart)
  onStartRef.current = onStart

  const disarm = useCallback(() => {
    const r = ref.current
    if (r.stream) r.stream.getTracks().forEach((t) => t.stop())
    if (r.ctx && r.ctx.state !== 'closed') r.ctx.close()
    ref.current = {}
    setArmed(false)
    setLevel(0)
  }, [])

  const arm = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
      const ctx = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: 'interactive',
      })
      await ctx.resume()

      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
      await ctx.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)

      const src = ctx.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(ctx, 'gun-detector')
      const mute = ctx.createGain()
      mute.gain.value = 0 // keeps the node running without playing any sound
      src.connect(node)
      node.connect(mute)
      mute.connect(ctx.destination)
      node.port.postMessage({ threshold })

      node.port.onmessage = (e) => {
        if (e.data.type === 'level') setLevel(e.data.level)
        if (e.data.type === 'trigger') {
          // Back-date the start by however long ago the spike was heard
          const delaySec = ctx.currentTime - e.data.time
          const startMs = Date.now() - delaySec * 1000
          disarm()
          onStartRef.current(startMs)
        }
      }

      ref.current = { stream, ctx, node }
      setArmed(true)
    } catch (err) {
      setError(
        err && err.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow it in your browser settings.'
          : 'Could not start the microphone.'
      )
      disarm()
    }
  }, [threshold, disarm])

  // Live sensitivity changes while armed
  useEffect(() => {
    if (ref.current.node) ref.current.node.port.postMessage({ threshold })
  }, [threshold])

  // Clean up if the component unmounts
  useEffect(() => disarm, [disarm])

  return { armed, level, error, threshold, setThreshold, arm, disarm }
}
