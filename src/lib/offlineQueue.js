// A tiny offline-resilience helper: queued actions persist in localStorage so a
// dropped connection doesn't lose a recorded tap. Each queue is scoped by a key
// (e.g. one per race) so different races/workouts don't interfere with each other.

const STORAGE_PREFIX = 'coaches-clock-queue:'

function loadQueue(key) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    return raw ? JSON.parse(raw) : []
  } catch {
    return [] // localStorage unavailable (private browsing, quota) - queue just won't persist
  }
}

function saveQueue(key, items) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(items))
  } catch {
    // ignore - best effort only
  }
}

export function enqueue(key, item) {
  const items = loadQueue(key)
  items.push(item)
  saveQueue(key, items)
}

export function dequeue(key, itemId) {
  saveQueue(key, loadQueue(key).filter((i) => i.id !== itemId))
}

export function getQueued(key) {
  return loadQueue(key)
}

export function clearQueue(key) {
  saveQueue(key, [])
}
