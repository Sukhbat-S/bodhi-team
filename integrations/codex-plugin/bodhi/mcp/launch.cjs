// Load only the explicit local HTTP endpoint and bearer, never database/provider keys.
const fs = require('node:fs');
const { parseEnv } = require('node:util');
try {
  if (process.env.BODHI_ENV_FILE) {
    const file = process.env.BODHI_ENV_FILE;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 1024 * 1024) throw new Error('unsafe environment file');
    const env = parseEnv(fs.readFileSync(file, 'utf8'));
    const port = env.BODHI_PORT || env.PORT || '4000';
    process.env.BODHI_URL = env.BODHI_URL || `http://localhost:${port}`;
    if (env.BODHI_API_TOKEN) process.env.BODHI_API_TOKEN = env.BODHI_API_TOKEN;
    else delete process.env.BODHI_API_TOKEN;
  }
  const endpoint = new URL(process.env.BODHI_URL || `http://localhost:${process.env.BODHI_PORT || '4000'}`);
  if (!['http:', 'https:'].includes(endpoint.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw new Error('unsupported endpoint');
  process.env.BODHI_URL = endpoint.origin;
  require('./server.cjs');
} catch {
  console.error('BODHI MCP startup failed: use a private regular BODHI_ENV_FILE and a loopback endpoint.');
  process.exitCode = 1;
}
