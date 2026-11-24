import React from 'react';
import PropTypes from 'prop-types';

export default function StateBadge({ state, children }) {
  const cls = state.toLowerCase().replace(/[^a-z]+/g, '-');
  return <span className={`wte-badge wte-badge-${cls}`}>{children || state}</span>;
}

StateBadge.propTypes = {
  state: PropTypes.string.isRequired,
  children: PropTypes.node
};
