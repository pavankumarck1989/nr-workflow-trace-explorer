import React from 'react';
import { NerdletStateContext } from 'nr1';
import Detail from './detail';

export default function WorkflowDetailNerdlet() {
  return (
    <NerdletStateContext.Consumer>
      {state => <Detail urlState={state || {}} />}
    </NerdletStateContext.Consumer>
  );
}
