// Open an entity in the platform in a new tab (the redirect URL resolves any
// entity type; the stacked entity view crashed for some entities).
export function openEntity(guid) {
  if (!guid) return;
  window.open(
    `https://one.newrelic.com/redirect/entity/${encodeURIComponent(guid)}`,
    '_blank',
    'noopener'
  );
}
