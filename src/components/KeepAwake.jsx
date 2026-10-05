import { useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'cc_keep_awake'

// Keeps the phone screen from auto-locking while `active` is true (clock running).
// The coach can switch it off; the choice is remembered on that phone.
// Uses the browser Screen Wake Lock API - where it isn't supported, nothing is shown.
export default function KeepAwake({ active }) {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== '0'
    } catch {
      return true
    }
  })
  const sentinelRef = useRef(null)

  function toggle(next) {
    setEnabled(next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
    } catch {
      // storage unavailable - setting just won't persist
    }
  }

  useEffect(() => {
    if (!supported || !active || !enabled) return undefined
    let cancelled = false

    async function acquire() {
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (cancelled) {
          lock.release().catch(() => {})
          return
        }
        sentinelRef.current = lock
        lock.addEventListener('release', () => {
          if (sentinelRef.current === lock) sentinelRef.current = null
        })
      } catch {
        // Denied (e.g. low battery mode) - the clock still runs fine, screen may just dim
      }
    }

    // The browser drops the lock whenever the page is hidden - re-grab it on return.
    function onVisible() {
      if (document.visibilityState === 'visible' && !sentinelRef.current) acquire()
    }

    acquire()
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      if (sentinelRef.current) {
        sentinelRef.current.release().catch(() => {})
        sentinelRef.current = null
      }
    }
  }, [supported, active, enabled])

  if (!supported) return null

  return (
    <label className="flex items-center justify-center gap-2 text-sm text-gray-700 mb-4 cursor-pointer">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => toggle(e.target.checked)}
        className="h-4 w-4"
      />
      Keep screen on while the clock is running
    </label>
  )
}
