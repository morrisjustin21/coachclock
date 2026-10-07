import { useGunStart } from '../hooks/useGunStart';

// inside your component
const gun = useGunStart((startMs) => {
  // call whatever your Start button already calls,
  // passing startMs as the start timestamp
  startRace(startMs);
});

// in your JSX, next to the Start button
<div className="mt-3 rounded-lg border p-3">
  <button
    onClick={gun.armed ? gun.disarm : gun.arm}
    className="w-full rounded-lg bg-slate-800 px-4 py-2 text-white"
  >
    {gun.armed ? 'Listening for gun… (tap to cancel)' : 'Start on sound of gun'}
  </button>

  {gun.armed && (
    <>
      <div className="mt-2 h-3 w-full overflow-hidden rounded bg-slate-200">
        <div
          className="h-full bg-green-500"
          style={{ width: `${Math.min(gun.level * 100, 100)}%` }}
        />
      </div>
      <label className="mt-2 block text-sm">
        Sensitivity (lower = more sensitive)
        <input
          type="range" min="0.1" max="0.9" step="0.05"
          value={gun.threshold}
          onChange={(e) => gun.setThreshold(Number(e.target.value))}
          className="w-full"
        />
      </label>
    </>
  )}
  {gun.error && <p className="mt-2 text-sm text-red-600">{gun.error}</p>}
</div>
