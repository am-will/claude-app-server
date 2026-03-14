function toCamelKey(key) {
  return key.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
}

function camelizeObject(value) {
  if (Array.isArray(value)) return value.map(camelizeObject);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[toCamelKey(k)] = camelizeObject(v);
    }
    return out;
  }
  return value;
}

/**
 * Accept snake_case aliases at the boundary and produce internal camelCase.
 * Preserves request identity semantics by preferring explicit camelCase `requestId`
 * and falling back to snake_case `request_id` when needed.
 */
function normalizeBoundaryInput(input = {}) {
  const normalized = camelizeObject(input);

  if (input.requestId !== undefined) {
    normalized.requestId = input.requestId;
  } else if (input.request_id !== undefined) {
    normalized.requestId = input.request_id;
  }

  return normalized;
}

module.exports = {
  normalizeBoundaryInput,
  toCamelKey,
  camelizeObject,
};
