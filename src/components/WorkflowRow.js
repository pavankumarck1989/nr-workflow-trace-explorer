import React from 'react';
import PropTypes from 'prop-types';
import StateBadge from './StateBadge';
import { activatable } from './a11y';
import { hashColor } from './colors';
import { REVIEW } from '../data/human';
import { formatAgo, formatDuration } from '../data/state';

// HIL decision badge looks: waiting is amber, approved green, declined red.
const REVIEW_STYLE = {
  [REVIEW.pending]: 'Waiting for human',
  [REVIEW.approved]: 'Completed',
  [REVIEW.declined]: 'Failed'
};

// One row of the summary table. Memoized so typing in the search box or
// changing a filter does not re-render the rows that did not change.
function WorkflowRow({
  r,
  now,
  lookup,
  correlationId,
  stateAttribute,
  reviewConfigured,
  reviewAttr,
  onOpen
}) {
  const reviewTitle = !reviewConfigured
    ? 'Set a state or decision attribute in Settings to fill this in'
    : r.review.involved
      ? `Decision attribute ${reviewAttr}: latest ${r.decisionValue || '(none yet)'}`
      : 'No human review seen';
  const inLoop = reviewConfigured && r.review.involved;
  return (
    <tr {...activatable(() => onOpen(r))}>
      <td className="wte-mono wte-id" title={r.workflowId}>
        {r.workflowId}
      </td>
      <td>
        {r.appName ? (
          <span className="wte-app">
            <span className="wte-dot" style={{ background: hashColor(r.appName) }} />
            {r.appName}
          </span>
        ) : (
          '-'
        )}
      </td>
      <td className="wte-txn" title={r.entry}>
        {r.entry || '-'}
      </td>
      <td title={stateAttribute ? `${stateAttribute} = ${r.stateValue || '(not set)'}` : undefined}>
        <StateBadge state={r.state}>
          {r.state}
          {r.state === 'Waiting for human' ? ` ${formatDuration(r.idleMs)}` : ''}
        </StateBadge>
      </td>
      <td className="wte-muted">{formatAgo(now - r.first)}</td>
      <td className="wte-muted">{formatAgo(r.idleMs)}</td>
      <td className="wte-num">{formatDuration(Math.max(0, r.lastEnd - r.first))}</td>
      <td title={reviewTitle}>
        {inLoop ? <span className="wte-hil-yes">Yes</span> : <span className="wte-muted">No</span>}
      </td>
      <td title={reviewTitle}>
        {inLoop ? (
          <StateBadge state={REVIEW_STYLE[r.review.status]}>{r.review.status}</StateBadge>
        ) : (
          <span className="wte-muted">-</span>
        )}
      </td>
      <td className="wte-num">{r.traces}</td>
      <td className="wte-num" title={r.whole ? `${r.spans} carry ${correlationId}` : undefined}>
        {!lookup ? r.spans : r.whole ? `${r.whole.count}${r.whole.approx ? '+' : ''}` : r.spans}
      </td>
      <td className="wte-num">{r.ents ? r.ents.entities : r.entities}</td>
      <td className="wte-num">{r.ents ? r.ents.databases : r.databases}</td>
      <td className="wte-num">
        {r.linkInfo ? (
          r.linkInfo.count ? (
            <span className="wte-pill-link" title="Span links touching this workflow">
              {r.linkInfo.count}
              {r.linkInfo.approx ? '+' : ''}
            </span>
          ) : (
            <span className="wte-muted">0</span>
          )
        ) : (
          <span className="wte-muted">-</span>
        )}
      </td>
      <td className="wte-num">
        {r.errors ? (
          <span className="wte-pill-err">{r.errors}</span>
        ) : (
          <span className="wte-muted">0</span>
        )}
      </td>
    </tr>
  );
}

WorkflowRow.propTypes = {
  r: PropTypes.object.isRequired,
  now: PropTypes.number.isRequired,
  lookup: PropTypes.bool.isRequired,
  correlationId: PropTypes.string.isRequired,
  stateAttribute: PropTypes.string,
  reviewConfigured: PropTypes.bool.isRequired,
  reviewAttr: PropTypes.string,
  onOpen: PropTypes.func.isRequired
};

export default React.memo(WorkflowRow);
