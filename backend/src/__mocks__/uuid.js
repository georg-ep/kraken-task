// CJS shim for uuid v13 (which ships ESM-only).
// Used by Jest moduleNameMapper to allow CJS test environments to import uuid.
const { randomUUID } = require('crypto');

function v4() {
  return randomUUID();
}

function v1() {
  // Simplified v1-like (just a UUID for test purposes)
  return randomUUID();
}

function validate(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function version(str) {
  if (!validate(str)) throw new TypeError('Invalid UUID');
  return parseInt(str[14], 16);
}

module.exports = { v4, v1, validate, version };
