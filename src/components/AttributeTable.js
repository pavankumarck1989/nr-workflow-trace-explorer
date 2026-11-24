import React, { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { attributeRows } from '../data/spanattrs';
import CopyButton from './CopyButton';

// Searchable name/value table of every attribute (used by span and log panels).
export default function AttributeTable({ attributes, title = 'Attributes' }) {
  const [filter, setFilter] = useState('');
  const rows = useMemo(() => attributeRows(attributes, filter), [attributes, filter]);
  return (
    <div>
      <div className="wte-panel-title">
        {title}{' '}
        <span className="wte-muted">
          ({rows.length}
          {filter ? ' matching' : ''})
        </span>
      </div>
      <input
        className="wte-input wte-panel-filter"
        placeholder="Filter by name or value"
        value={filter}
        onChange={e => setFilter(e.target.value)}
      />
      <table className="wte-attrs">
        <tbody>
          {rows.map(r => (
            <tr key={r.key}>
              <td className="wte-attr-key">{r.key}</td>
              <td className="wte-attr-val">
                {r.value}
                <CopyButton text={r.value} className="wte-copy" title="Copy value" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <div className="wte-empty">No attributes match.</div>}
    </div>
  );
}

AttributeTable.propTypes = {
  attributes: PropTypes.object,
  title: PropTypes.string
};
