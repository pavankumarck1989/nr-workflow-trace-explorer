// Human-in-the-loop review: did the workflow wait for a person, and what is
// the current decision. Pure functions.

export const REVIEW = {
  none: 'None',
  pending: 'Pending',
  approved: 'Approved',
  declined: 'Declined'
};

// Values (lower case) in a comma separated Settings list.
export const valueList = csv =>
  String(csv || '')
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);

const regexEscape = v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Case-insensitive whole-value regex for NRQL RLIKE, or null for an empty list.
export function valuePattern(csv) {
  const vals = valueList(csv);
  return vals.length ? `(?i)^(${vals.map(regexEscape).join('|')})$` : null;
}

// Which attribute carries the waiting stage and which the decision. The
// decision attribute falls back to the state attribute.
export const humanAttrs = attrs => ({
  waitAttr: attrs.stateAttribute || '',
  decisionAttr: attrs.decisionAttribute || attrs.stateAttribute || ''
});

// { involved, status } from the latest time a "waiting for human" value and a
// decision value were seen, and the latest decision value. A decision stays
// current until the workflow waits for a person again.
export function humanReview({ waitTs, decisionTs, decisionValue }, values) {
  const hasWait = Number.isFinite(waitTs);
  const hasDecision = Number.isFinite(decisionTs);
  if (!hasWait && !hasDecision) return { involved: false, status: REVIEW.none };
  if (hasDecision && (!hasWait || decisionTs >= waitTs)) {
    const v = String(decisionValue || '')
      .trim()
      .toLowerCase();
    if (valueList(values.Approved).includes(v)) return { involved: true, status: REVIEW.approved };
    if (valueList(values.Declined).includes(v)) return { involved: true, status: REVIEW.declined };
  }
  return { involved: true, status: REVIEW.pending };
}

// The same from loaded spans (normalized, with raw attributes).
export function humanReviewFromSpans(spans, attrs, values) {
  const { waitAttr, decisionAttr } = humanAttrs(attrs);
  if (!waitAttr && !decisionAttr) return null;
  const wait = new Set(valueList(values['Waiting for human']));
  const decision = new Set([...valueList(values.Approved), ...valueList(values.Declined)]);
  const val = (s, a) =>
    String((s.attributes && s.attributes[a]) || '')
      .trim()
      .toLowerCase();
  let waitTs;
  let decisionTs;
  let decisionValue;
  for (const s of spans) {
    if (waitAttr && wait.has(val(s, waitAttr)) && !(s.start < waitTs)) waitTs = s.start;
    if (decisionAttr && decision.has(val(s, decisionAttr)) && !(s.start < decisionTs)) {
      decisionTs = s.start;
      decisionValue = val(s, decisionAttr);
    }
  }
  return humanReview({ waitTs, decisionTs, decisionValue }, values);
}

// Sort rank: none, pending, approved, declined.
export const reviewRank = status =>
  [REVIEW.none, REVIEW.pending, REVIEW.approved, REVIEW.declined].indexOf(status);
