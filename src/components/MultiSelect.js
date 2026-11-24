import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

// Dropdown with a filter box and checkboxes, for picking several values.
export default function MultiSelect({ label, options, value, onChange, loading }) {
  const [open, setOpen] = useState(false);
  const [needle, setNeedle] = useState('');
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = e => box.current && !box.current.contains(e.target) && setOpen(false);
    const esc = e => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const chosen = new Set(value);
  const shown = options.filter(o => o.value.toLowerCase().includes(needle.toLowerCase()));
  const toggle = v => onChange(chosen.has(v) ? value.filter(x => x !== v) : [...value, v]);
  const summary =
    value.length === 0 ? 'All' : value.length === 1 ? value[0] : `${value.length} selected`;

  return (
    <div className="wte-ms" ref={box}>
      <button
        type="button"
        className={`wte-btn wte-ms-btn${value.length ? ' wte-ms-active' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label}: <b>{summary}</b> <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="wte-ms-pop" role="listbox" aria-multiselectable="true">
          <input
            className="wte-input"
            placeholder={`Filter ${label.toLowerCase()}s`}
            aria-label={`Filter ${label.toLowerCase()}s`}
            value={needle}
            onChange={e => setNeedle(e.target.value)}
            autoFocus
          />
          <div className="wte-ms-actions">
            <button
              type="button"
              className="wte-linkbtn"
              onClick={() => onChange(shown.map(o => o.value))}
            >
              Select shown
            </button>
            <button type="button" className="wte-linkbtn" onClick={() => onChange([])}>
              Clear
            </button>
          </div>
          <div className="wte-ms-list">
            {loading && <div className="wte-muted wte-pad">Loading…</div>}
            {!loading && !shown.length && <div className="wte-muted wte-pad">No matches</div>}
            {shown.map(o => (
              <label
                key={o.value}
                className="wte-ms-item"
                role="option"
                aria-selected={chosen.has(o.value)}
              >
                <input
                  type="checkbox"
                  checked={chosen.has(o.value)}
                  onChange={() => toggle(o.value)}
                />
                <span className="wte-ms-name" title={o.value}>
                  {o.value}
                </span>
                {o.hint && <span className="wte-muted">{o.hint}</span>}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

MultiSelect.propTypes = {
  label: PropTypes.string.isRequired,
  options: PropTypes.arrayOf(
    PropTypes.shape({ value: PropTypes.string.isRequired, hint: PropTypes.string })
  ).isRequired,
  value: PropTypes.arrayOf(PropTypes.string).isRequired,
  onChange: PropTypes.func.isRequired,
  loading: PropTypes.bool
};
