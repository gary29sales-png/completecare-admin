const { spawn } = require('node:child_process');
const path = require('node:path');
const { validateProductionConfig } = require('./validate-production-config');

try {
  validateProductionConfig();
} catch (error) {
  console.error(`Production configuration is invalid: ${error.message}`);
  process.exit(1);
}

const nextBin = require.resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, 'start'], {
  env: process.env,
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..'),
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code === null ? 1 : code);
  }
});
