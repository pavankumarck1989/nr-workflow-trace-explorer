import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import AttributeTable from './AttributeTable';
import { formatDuration } from '../data/state';
import LogPanel from './LogPanel';
import { openEntity } from './entityLink';
import PerformancePanel from './PerformancePanel';
import CopyButton from './CopyButton';
import { spanError } from '../data/spanattrs';

// Side panel with every attribute of the selected span, plus its logs.
const fmtTs = ts => new Date(ts).toISOString().replace('T', ' ').replace('Z', ' UTC');

function LinkCards({ links, loadedTraces, loading, onLoad }) {
  if (!links.length) return <div className="wte-empty">This span has no span links.</div>;
  return (
    <div>
      <p className="wte-muted">
        Forward: another span continues from this one. Backward: this span continues from another.
      </p>
      {(() => {
        const missing = [
          ...new Set(links.filter(l => !loadedTraces.has(l.traceId)).map(l => l.traceId))
        ];
        return missing.length > 1 ? (
          <button
            type="button"
            className="wte-btn"
            disabled={loading}
            onClick={() => onLoad(missing, null)}
          >
            {loading ? 'Loading…' : `Load all ${missing.length} linked traces into the waterfall`}
          </button>
        ) : null;
      })()}
      {links.map((l, i) => (
        <div key={i} className={`wte-linkcard${l.crossTrace ? ' wte-linkcard-cross' : ''}`}>
          <div className="wte-kv">
            <span>Trace id</span>
            <b title={l.traceId}>
              {l.traceId.slice(0, 12)}… <span className="wte-linkdir">{l.direction}</span>
              {l.crossTrace && <span className="wte-tag">other trace</span>}
            </b>
            {l.name && (
              <>
                <span>Span</span>
                <b>
                  {l.name}
                  {l.service ? ` (${l.service})` : ''}
                </b>
              </>
            )}
            <span>Timestamp</span>
            <b>{fmtTs(l.timestamp)}</b>
            {l.durMs !== null && (
              <>
                <span>Duration</span>
                <b>{formatDuration(l.durMs)}</b>
              </>
            )}
            <span>Status</span>
            <b className={l.isError ? 'wte-bad' : ''}>{l.isError ? 'error' : 'ok'}</b>
          </div>
          <button
            type="button"
            className="wte-btn wte-linkcard-go"
            disabled={loading}
            onClick={() => onLoad([l.traceId], l.spanId)}
          >
            {loadedTraces.has(l.traceId)
              ? 'Go to span in waterfall'
              : loading
                ? 'Loading…'
                : 'Load trace and go to span'}
          </button>
        </div>
      ))}
    </div>
  );
}

LinkCards.propTypes = {
  links: PropTypes.array.isRequired,
  loadedTraces: PropTypes.instanceOf(Set).isRequired,
  loading: PropTypes.bool.isRequired,
  onLoad: PropTypes.func.isRequired
};

export default function SpanPanel({
  accountId,
  attrs,
  span,
  parent,
  logs,
  links,
  loadedTraces,
  loadingLinked,
  onLoadLinked,
  onClose,
  onSelect,
  onSelectLog
}) {
  const [tab, setTab] = useState(links.length ? 'Span links' : 'Details');
  const err = spanError(span);
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className="wte-panel">
      <div className="wte-panel-head">
        <div>
          <div className="wte-muted">
            {span.system}
            {span.service && span.service !== span.system ? ' | ' : ''}
            {span.service && span.service !== span.system && span.entityGuid ? (
              <button
                type="button"
                className="wte-linkbtn"
                title="Open entity"
                onClick={() => openEntity(span.entityGuid)}
              >
                {span.service} &#8599;
              </button>
            ) : (
              span.service && span.service !== span.system && span.service
            )}
          </div>
          <h3 title={span.name}>{span.name}</h3>
        </div>
        <button className="wte-btn" onClick={onClose} title="Close (Esc)">
          Close
        </button>
      </div>

      <div className="wte-panel-tabs" role="tablist">
        {['Details', 'Logs', 'Performance', 'Span links'].map(t => (
          <button
            type="button"
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'wte-tab-active' : ''}
            onClick={() => setTab(t)}
          >
            {t}
            {t === 'Span links' ? ` (${links.length})` : ''}
            {t === 'Logs' ? ` (${logs.length})` : ''}
          </button>
        ))}
      </div>

      <div className="wte-panel-body">
        {tab === 'Performance' && (
          <PerformancePanel accountId={accountId} attrs={attrs} span={span} />
        )}
        {tab === 'Span links' && (
          <LinkCards
            links={links}
            loadedTraces={loadedTraces}
            loading={loadingLinked}
            onLoad={onLoadLinked}
          />
        )}
        {tab === 'Details' && (
          <>
            {err && (
              <div className="wte-errbox" role="alert">
                <div className="wte-errbox-head">
                  <b>Error{err.errorClass ? `: ${err.errorClass}` : ''}</b>
                  {err.message && (
                    <CopyButton
                      text={err.message}
                      className="wte-copy-on"
                      title="Copy the error message"
                    />
                  )}
                </div>
                <div className="wte-errbox-msg">
                  {err.message || 'No error message was recorded on this span.'}
                </div>
                {err.stack && (
                  <details>
                    <summary>Stack trace</summary>
                    <pre>{err.stack}</pre>
                  </details>
                )}
              </div>
            )}
            <div className="wte-kv">
              <span>Duration</span>
              <b>{formatDuration(span.durMs)}</b>
              <span>Status</span>
              <b className={span.isError ? 'wte-bad' : ''}>{span.status || 'unset'}</b>
              <span>Start</span>
              <b>{new Date(span.start).toISOString().replace('T', ' ').replace('Z', ' UTC')}</b>
              <span>Trace id</span>
              <b>{span.traceId}</b>
              <span>Span id</span>
              <b>{span.id}</b>
              <span>Parent</span>
              <b>
                {span.parentId ? (
                  parent ? (
                    <button
                      type="button"
                      className="wte-linkbtn wte-underline"
                      onClick={() => onSelect(parent.id)}
                    >
                      {parent.name}
                    </button>
                  ) : (
                    <span className="wte-tag wte-tag-warn" title="Parent span missing">
                      missing: {span.parentId}
                    </span>
                  )
                ) : (
                  'none (root)'
                )}
              </b>
            </div>

            <AttributeTable attributes={span.attributes} />
          </>
        )}
        {tab === 'Logs' && (
          <LogPanel logs={logs} title="Logs for this span" onSelect={onSelectLog} compact />
        )}
      </div>
    </aside>
  );
}

SpanPanel.propTypes = {
  accountId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  attrs: PropTypes.object.isRequired,
  span: PropTypes.object.isRequired,
  parent: PropTypes.object,
  logs: PropTypes.array.isRequired,
  links: PropTypes.array.isRequired,
  loadedTraces: PropTypes.instanceOf(Set).isRequired,
  loadingLinked: PropTypes.bool.isRequired,
  onLoadLinked: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  onSelect: PropTypes.func.isRequired,
  onSelectLog: PropTypes.func.isRequired
};
