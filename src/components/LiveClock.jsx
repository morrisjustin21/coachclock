import { useEffect, useState } from 'react'
import { formatTime } from '../lib/csv'

function computeElapsed(clockLike) {
  if (!clockLike) return 0
  const base = clockLike.accumulated_ms || 0
  if (clockLike.running && clockLike.started_at) {
    return base + (Date.now() - new Date(clockLike.started_at).getTime())
  }
  return base
}

// Self-contained ticking clock. Only this tiny component re-renders as time
// passes (about 10 times a second, lined up with the tenths digit) instead of
// the whole race screen re-rendering 60 times a second. The time is always
// computed from the start timestamp, so accuracy is unaffected.
export default function LiveClock({ clock, className = '' }) {
  const running = !!clock?.running
  const startedAt = clock?.started_at
  const accumulated = clock?.accumulated_ms
  const [ms, setMs] = useState(() => computeElapsed(clock))

  useEffect(() => {
    setMs(computeElapsed(clock))
    if (!running) return undefined

    let timer
    function tick() {
      const e = computeElapsed(clock)
      setMs(e)
      // Wait until just after the next tenth-of-a-second boundary.
      timer = setTimeout(tick, 100 - (e % 100) + 2)
    }
    tick()

    // Browsers slow timers in background tabs - catch up the instant we're visible again.
    function onVisible() {
      if (!document.hidden) setMs(computeElapsed(clock))
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [running, startedAt, accumulated])

  return <span className={className}>{formatTime(ms)}</span>
}
