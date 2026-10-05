// Big, high-contrast Start / Stop / Resume button - readable in direct sun
// and easy to hit with a thumb.
export default function ClockButton({ running, hasTime, onClick }) {
  const label = running ? 'Stop' : hasTime ? 'Resume' : 'Start'
  const color = running ? 'bg-red-700 active:bg-red-800' : 'bg-emerald-700 active:bg-emerald-800'
  return (
    <button
      onClick={onClick}
      className={`${color} text-white rounded-xl min-w-[150px] px-8 py-4 text-xl font-bold`}
    >
      {label}
    </button>
  )
}
