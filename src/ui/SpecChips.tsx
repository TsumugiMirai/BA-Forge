import type { SpecRow } from '../cloud/specs'

/** a specialization's badge: its icon, else its first letter */
export function SpecBadge({ spec, size = 18 }: { spec: Pick<SpecRow, 'name' | 'icon'>; size?: number }) {
  return (
    <span className="spec-badge" style={{ width: size, height: size, fontSize: Math.round(size * 0.6) }}>
      {spec.icon ? <img src={spec.icon} alt="" /> : (spec.name || '?').slice(0, 1)}
    </span>
  )
}

/** The six China specializations as toggles; `selected` are switched on. */
export function SpecChips(props: {
  specs: SpecRow[]
  selected: number[]
  disabled?: boolean
  onToggle(specId: number): void
}) {
  const { specs, selected, disabled } = props
  return (
    <div className="spec-chips">
      {specs.map((s) => {
        const on = selected.includes(s.id)
        return (
          <button
            key={s.id}
            type="button"
            className={`spec-chip ${on ? 'on' : ''}`}
            aria-pressed={on}
            disabled={disabled}
            title={s.description || s.name}
            onClick={() => props.onToggle(s.id)}
          >
            <SpecBadge spec={s} />
            <span className="spec-chip-name">{s.name || `#${s.id}`}</span>
            {on && <span className="spec-chip-check">✓</span>}
          </button>
        )
      })}
    </div>
  )
}
