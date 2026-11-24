import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import AttributeTable from './AttributeTable';
import { prettyMessage } from '../data/logs';
import CopyButton from './CopyButton';

// Side panel with the full payload of one log: message, then every attribute.
export default function LogDetailPanel({ log, span, onClose, onGoToSpan }) {
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const msg = prettyMessage(log.message);
  const json = JSON.stringify(log.attributes, null, 2);

  return (
    <aside className="wte-panel wte-panel-top">
      <div className="wte-panel-head">
        <div>
          <div className="wte-muted">Log{log.service ? ` | ${log.service}` : ''}</div>
          <h3>
            <span className={`wte-lvl wte-lvl-${log.level.toLowerCase()}`}>{log.level}</span>{' '}
            {new Date(log.ts).toISOString().replace('T', ' ').replace('Z', ' UTC')}
          </h3>
        </div>
        <button className="wte-btn" onClick={onClose} title="Close (Esc)">
          Close
        </button>
      </div>
      <div className="wte-panel-body">
        <div className="wte-kv">
          <span>Trace id</span>
          <b>{log.traceId || '-'}</b>
          <span>Span</span>
          <b>
            {log.spanId ? (
              span ? (
                <button
                  type="button"
                  className="wte-linkbtn wte-underline"
                  onClick={() => onGoToSpan(span.id)}
                >
                  {span.name}
                </button>
              ) : (
                log.spanId
              )
            ) : (
              '-'
            )}
          </b>
        </div>

        <div className="wte-panel-title">
          Message {msg.json && <span className="wte-muted">(JSON)</span>}
          <CopyButton text={log.message} className="wte-copy-on" title="Copy the message" />
        </div>
        <pre className="wte-msg">{msg.text || '(empty)'}</pre>

        <AttributeTable attributes={log.attributes} title="Attributes" />

        <div className="wte-panel-title">
          Raw payload{' '}
          <CopyButton
            text={json}
            label="copy JSON"
            className="wte-copy-on"
            title="Copy the payload"
          />
        </div>
        <pre className="wte-msg wte-msg-json">{json}</pre>
      </div>
    </aside>
  );
}

LogDetailPanel.propTypes = {
  log: PropTypes.object.isRequired,
  span: PropTypes.object,
  onClose: PropTypes.func.isRequired,
  onGoToSpan: PropTypes.func.isRequired
};
