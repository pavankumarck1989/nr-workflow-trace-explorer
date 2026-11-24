import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { Button, Select, SelectItem, TextField } from 'nr1';
import { saveConfig } from '../data/settings';
import { DEFAULT_STATE_VALUES, WORKFLOW_ID_PRESETS, mergeConfig } from '../config/attributes';
import { STATES } from '../data/state';

// Edit attribute names, system rules and thresholds as JSON.
export default function SettingsPanel({ accountId, config, onSaved }) {
  const [text, setText] = useState(JSON.stringify(config, null, 2));
  const [msg, setMsg] = useState('');
  const current = config.attrs.correlationId;
  const isPreset = WORKFLOW_ID_PRESETS.some(p => p.id === current);
  const [custom, setCustom] = useState(isPreset ? '' : current);
  const [choice, setChoice] = useState(isPreset ? current : 'custom');
  const workflowAttr = choice === 'custom' ? custom.trim() : choice;
  const [stateAttr, setStateAttr] = useState(config.attrs.stateAttribute || '');
  const [decisionAttr, setDecisionAttr] = useState(config.attrs.decisionAttribute || '');
  const [stateVals, setStateVals] = useState({ ...DEFAULT_STATE_VALUES, ...config.stateValues });

  const save = async () => {
    try {
      const parsed = JSON.parse(text);
      // The workflow id field applies to spans and logs together.
      if (workflowAttr) {
        parsed.attrs = {
          ...parsed.attrs,
          correlationId: workflowAttr,
          logCorrelationId: workflowAttr
        };
      }
      // The state attribute and its values come from the fields above the JSON.
      parsed.attrs = {
        ...parsed.attrs,
        stateAttribute: stateAttr.trim(),
        decisionAttribute: decisionAttr.trim()
      };
      parsed.stateValues = stateVals;
      const next = mergeConfig(parsed);
      await saveConfig(accountId, next);
      setText(JSON.stringify(next, null, 2));
      setMsg('Saved.');
      onSaved(next);
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
  };
  return (
    <div className="wte-settings">
      <p>Settings for account {accountId}.</p>
      <div className="wte-filters">
        <strong>Workflow ID attribute</strong>
        <Select value={choice} onChange={(e, v) => setChoice(v)}>
          {WORKFLOW_ID_PRESETS.map(p => (
            <SelectItem key={p.id} value={p.id}>
              {p.label}
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom attribute…</SelectItem>
        </Select>
        {choice === 'custom' && (
          <TextField
            placeholder="attribute name, e.g. workflow.id"
            value={custom}
            onChange={e => setCustom(e.target.value)}
          />
        )}
      </div>
      <p className="wte-muted">
        Spans and logs are grouped by this attribute. Use the trace ID for one trace per workflow,
        or an attribute shared across traces (for example the Temporal workflow ID) to stitch them
        together.
      </p>
      <div className="wte-filters">
        <strong>Workflow state attribute</strong>
        <TextField
          placeholder="optional, e.g. workflow.status"
          value={stateAttr}
          onChange={e => setStateAttr(e.target.value)}
        />
      </div>
      <p className="wte-muted">
        When set, the latest value of this attribute on the workflow&apos;s spans decides its state,
        using the value lists below (comma separated, not case sensitive). When a workflow has no
        value for it, or the value is in no list, it shows Failed if any span has an error and
        Completed otherwise. With no attribute set, every workflow is Failed or Completed that way.
      </p>
      <div className="wte-filters">
        <strong>Human decision attribute</strong>
        <TextField
          placeholder="optional, defaults to the state attribute"
          value={decisionAttr}
          onChange={e => setDecisionAttr(e.target.value)}
        />
      </div>
      <p className="wte-muted">
        Feeds the HIL (human in the loop) and HIL decision columns, which show - until an attribute
        is set. A workflow is in a human loop once the attribute shows a &quot;Waiting for
        human&quot; value or an Approved / Declined value. Pending means it is waiting for a person;
        otherwise the latest decision is shown. A new wait clears an old decision.
      </p>
      {(stateAttr.trim() || decisionAttr.trim()) && (
        <div className="wte-state-map">
          {STATES.map(st => (
            <label key={st}>
              <span>{st}</span>
              <TextField
                value={stateVals[st] || ''}
                onChange={e => setStateVals({ ...stateVals, [st]: e.target.value })}
              />
            </label>
          ))}
          {['Approved', 'Declined'].map(k => (
            <label key={k}>
              <span>{k} (decision values)</span>
              <TextField
                value={stateVals[k] || ''}
                onChange={e => setStateVals({ ...stateVals, [k]: e.target.value })}
              />
            </label>
          ))}
        </div>
      )}
      <p>Advanced: attribute names, system rules and thresholds (JSON).</p>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={24} />
      <div>
        <Button type={Button.TYPE.PRIMARY} sizeType={Button.SIZE_TYPE.SMALL} onClick={save}>
          Save
        </Button>{' '}
        <span>{msg}</span>
      </div>
    </div>
  );
}

SettingsPanel.propTypes = {
  accountId: PropTypes.number.isRequired,
  config: PropTypes.object.isRequired,
  onSaved: PropTypes.func.isRequired
};
