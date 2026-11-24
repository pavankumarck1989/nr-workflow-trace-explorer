import React, { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { isErrorLevel } from '../data/logs';
import { activatable, clickable } from './a11y';

const LEVELS = ['ERROR', 'WARN', 'INFO', 'DEBUG'];
const levelOf = l => (l === 'FATAL' || l === 'SEVERE' ? 'ERROR' : l === 'WARNING' ? 'WARN' : l);
const time = ts => new Date(ts).toISOString().slice(11, 23);
const full = ts => new Date(ts).toISOString().replace('T', ' ').replace('Z', ' UTC');

// Filterable log table. Clicking a row opens the full payload (onSelect).
export default function LogPanel({ logs, title, onSelect, selected, compact }) {
  const [level, setLevel] = useState('ALL');
  const [text, setText] = useState('');
  const [newest, setNewest] = useState(false);

  const counts = useMemo(() => {
    const c = {};
    logs.forEach(l => {
      const k = levelOf(l.level);
      c[k] = (c[k] || 0) + 1;
    });
    return c;
  }, [logs]);

  const shown = useMemo(() => {
    const t = text.toLowerCase();
    const list = logs.filter(
      l =>
        (level === 'ALL' || levelOf(l.level) === level) &&
        (!t || l.message.toLowerCase().includes(t) || (l.service || '').toLowerCase().includes(t))
    );
    return newest ? list.slice().reverse() : list;
  }, [logs, level, text, newest]);

  return (
    <div className="wte-loglist">
      <div className="wte-log-toolbar">
        <strong>{title}</strong>
        <span className="wte-muted">
          {shown.length} of {logs.length}
        </span>
        <div className="wte-log-chips">
          <span
            className={`wte-lchip${level === 'ALL' ? ' wte-lchip-on' : ''}`}
            {...clickable(() => setLevel('ALL'))}
          >
            All
          </span>
          {LEVELS.filter(l => counts[l]).map(l => (
            <span
              key={l}
              className={`wte-lchip wte-lchip-${l.toLowerCase()}${level === l ? ' wte-lchip-on' : ''}`}
              {...clickable(() => setLevel(level === l ? 'ALL' : l))}
            >
              {l} {counts[l]}
            </span>
          ))}
        </div>
        <input
          className="wte-input wte-log-search"
          placeholder="Filter message or service"
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <label className="wte-check">
          <input type="checkbox" checked={newest} onChange={e => setNewest(e.target.checked)} />{' '}
          Newest first
        </label>
      </div>
      <div className="wte-logtable">
        {shown.slice(0, 500).map((l, i) => (
          <div
            key={i}
            className={`wte-logrow${selected === l ? ' wte-logrow-on' : ''}${isErrorLevel(l.level) ? ' wte-logrow-err' : ''}`}
            {...activatable(() => onSelect && onSelect(l))}
            title="Click to view the full log"
          >
            <span className="wte-logrow-time" title={full(l.ts)}>
              {time(l.ts)}
            </span>
            <span className={`wte-lvl wte-lvl-${levelOf(l.level).toLowerCase()}`}>
              {levelOf(l.level)}
            </span>
            {!compact && <span className="wte-logrow-svc">{l.service || '-'}</span>}
            <span className="wte-logrow-msg">
              {l.message || <span className="wte-muted">(empty message)</span>}
            </span>
          </div>
        ))}
        {!shown.length && <div className="wte-empty">No logs.</div>}
        {shown.length > 500 && (
          <div className="wte-muted wte-pad">
            Showing the first 500. Use the filters to narrow down.
          </div>
        )}
      </div>
    </div>
  );
}

LogPanel.propTypes = {
  logs: PropTypes.array.isRequired,
  title: PropTypes.string,
  onSelect: PropTypes.func,
  selected: PropTypes.object,
  compact: PropTypes.bool
};
