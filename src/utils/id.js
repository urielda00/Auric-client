/** Small id helper for client-generated entities (queue entries, added tracks, history rows). */
let counter = 0;

export function generateId(prefix = 'id') {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}
