import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { BillboardChart, HistogramChart, LineChart } from 'nr1';
import { spanPerformanceNrql } from '../data/queries';
import { formatDuration } from '../data/state';

const AROUND_MS = 30 * 60 * 1000;

// Performance of this kind of span (same service and name) in the half hour
// either side of it, like the Performance tab of the platform's trace view.
export default function PerformancePanel({ accountId, attrs, span }) {
  const nrql = useMemo(() => {
    const begin = Math.floor(span.start - AROUND_MS);
    const end = Math.min(Date.now(), Math.ceil(span.start + AROUND_MS));
    const make = kind => spanPerformanceNrql(attrs, span, kind, begin, end);
    return {
      summary: make('summary'),
      duration: make('duration'),
      throughput: make('throughput'),
      histogram: make('histogram')
    };
  }, [attrs, span]);
  const ids = [Number(accountId)];

  return (
    <div className="wte-perf">
      <p className="wte-muted">
        All {span.service ? `${span.service} ` : ''}
        <b>{span.name}</b> spans, 30 minutes either side of this one. This span took{' '}
        <b>{formatDuration(span.durMs)}</b>.
      </p>
      <div className="wte-perf-chart wte-perf-billboard">
        <BillboardChart accountIds={ids} query={nrql.summary} />
      </div>
      <div className="wte-panel-title">Average duration</div>
      <div className="wte-perf-chart">
        <LineChart accountIds={ids} query={nrql.duration} />
      </div>
      <div className="wte-panel-title">Throughput (calls per minute)</div>
      <div className="wte-perf-chart">
        <LineChart accountIds={ids} query={nrql.throughput} />
      </div>
      <div className="wte-panel-title">Span duration histogram (ms)</div>
      <div className="wte-perf-chart">
        <HistogramChart accountIds={ids} query={nrql.histogram} />
      </div>
    </div>
  );
}

PerformancePanel.propTypes = {
  accountId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  attrs: PropTypes.object.isRequired,
  span: PropTypes.object.isRequired
};
