const store = require('./store');
const { getAdminOrigin, getPublicAllowedOrigins, isProduction } = require('./config');
const { getAuthConfig } = require('./auth');

async function checkReadiness() {
  if (isProduction()) {
    getAuthConfig();
    getAdminOrigin();
    getPublicAllowedOrigins();
  }
  const storage = await store.check();
  return { status: 'ok', storage: storage.backend };
}

module.exports = { checkReadiness };
