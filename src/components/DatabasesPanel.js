import React from 'react';
import PropTypes from 'prop-types';
import { activatable } from './a11y';
import { summarizeDatabases, statementOf } from '../data/databases';
import { formatDuration } from '../data/state';

// Databases the workflow called, and its slowest database spans.
export default function DatabasesPanel({ spans, onSelect }) {
  const { databases, slow } = summarizeDatabases(spans);
  if (!databases.length) {
    return <div className="wte-empty">No database spans found in this workflow.</div>;
  }
  return (
    <div>
      <table className="wte-table">
        <thead>
          <tr>
            <th>Database</th>
            <th>Calls</th>
            <th>Error calls</th>
            <th>Total time</th>
            <th>Avg</th>
            <th>Slowest</th>
            <th>Called by</th>
          </tr>
        </thead>
        <tbody>
          {databases.map(d => (
            <tr key={d.system}>
              <td>{d.system}</td>
              <td>{d.calls}</td>
              <td className={d.errors ? 'wte-bad' : ''}>{d.errors}</td>
              <td>{formatDuration(d.totalMs)}</td>
              <td>{formatDuration(d.avgMs)}</td>
              <td>{formatDuration(d.maxMs)}</td>
              <td>{d.services.join(', ') || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>Slowest database calls</h4>
      <table className="wte-table wte-clickable">
        <thead>
          <tr>
            <th>Database</th>
            <th>Span</th>
            <th>Statement</th>
            <th>Service</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          {slow.map(s => (
            <tr key={s.id} {...activatable(() => onSelect(s.id))}>
              <td>{s.dbSystem}</td>
              <td>{s.name}</td>
              <td className="wte-mono wte-txn" title={statementOf(s)}>
                {statementOf(s) || '-'}
              </td>
              <td>{s.service || '-'}</td>
              <td className={s.isError ? 'wte-bad' : ''}>{formatDuration(s.durMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

DatabasesPanel.propTypes = {
  spans: PropTypes.array.isRequired,
  onSelect: PropTypes.func.isRequired
};
