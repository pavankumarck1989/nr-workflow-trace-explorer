// Attribute rows for the span side panel. Pure functions.

const fmt = v => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v));

// All non-empty attributes, sorted by key, optionally filtered by key/value.
export function attributeRows(attributes, filter = '') {
  const f = filter.trim().toLowerCase();
  return Object.keys(attributes || {})
    .filter(k => {
      const v = attributes[k];
      return v !== null && v !== undefined && v !== '';
    })
    .sort((a, b) => a.localeCompare(b))
    .map(k => ({ key: k, value: fmt(attributes[k]) }))
    .filter(r => !f || r.key.toLowerCase().includes(f) || r.value.toLowerCase().includes(f));
}

// Attributes that carry an error's text, in order of preference. New Relic agents
// write error.*, OpenTelemetry writes exception.* and otel.status_description.
const ERROR_MESSAGE_KEYS = [
  'error.message',
  'exception.message',
  'otel.status_description',
  'status.message',
  'statusMessage'
];
const ERROR_CLASS_KEYS = ['error.class', 'exception.type', 'error.type'];
const ERROR_STACK_KEYS = ['exception.stacktrace', 'error.stack', 'error.stacktrace'];

const firstText = (attributes, keys) => {
  for (const k of keys) {
    const v = attributes && attributes[k];
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v);
  }
  return '';
};

// What to show when a span is in error: { message, errorClass, stack }, or null
// when the span is not an error. A failed span with no text still returns an
// object (all empty) so the panel can say no message was recorded.
export function spanError(span) {
  if (!span || !span.isError) return null;
  const a = span.attributes || {};
  return {
    message: firstText(a, ERROR_MESSAGE_KEYS),
    errorClass: firstText(a, ERROR_CLASS_KEYS),
    stack: firstText(a, ERROR_STACK_KEYS)
  };
}
