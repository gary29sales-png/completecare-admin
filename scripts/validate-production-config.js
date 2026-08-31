const { getAdminOrigin, getPublicAllowedOrigins } = require('../lib/config');
const { getAuthConfig } = require('../lib/auth');
const store = require('../lib/store');

function validateProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return;

  getAuthConfig();
  getAdminOrigin();
  getPublicAllowedOrigins();
  if (store.backendName() !== 'supabase') {
    throw new Error('Production storage must use Supabase.');
  }
}

if (require.main === module) {
  try {
    validateProductionConfig();
  } catch (error) {
    console.error(`Production configuration is invalid: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { validateProductionConfig };
