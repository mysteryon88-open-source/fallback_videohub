const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function getComposeServiceBlock(compose, serviceName) {
  const serviceMatch = compose.replace(/\r\n/g, '\n').match(new RegExp(`^  ${serviceName}:\\n((?:    .*\\n?)*)`, 'm'));

  assert.ok(serviceMatch, `docker-compose.yml should include services.${serviceName}`);
  return serviceMatch[1];
}

test('docker build context excludes local secrets and build-only files', () => {
  const dockerignore = fs
    .readFileSync(path.join(root, '.dockerignore'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const pattern of ['.env*', '.dockerignore', 'Dockerfile']) {
    assert.ok(dockerignore.includes(pattern), `.dockerignore should include ${pattern}`);
  }
});

test('docker image copies only runtime files instead of the whole project context', () => {
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

  assert.doesNotMatch(dockerfile, /^\s*COPY\s+\.\s+\.\s*$/m);
  assert.doesNotMatch(dockerfile, /^\s*COPY\s+scripts\s+\.\/scripts\s*$/m);
  assert.doesNotMatch(dockerfile, /generate-local-previews\.mjs/);
  for (const runtimeCopy of [
    'COPY server.js ./',
    'COPY server ./server',
    'COPY scripts/app.js scripts/catalog-data.js scripts/channel.js scripts/client-api.js scripts/player.js ./scripts/',
    'COPY assets ./assets'
  ]) {
    assert.ok(dockerfile.includes(runtimeCopy), `Dockerfile should include ${runtimeCopy}`);
  }
});

test('http redirect uses the configured canonical domain instead of request Host', () => {
  const nginxConfig = fs.readFileSync(path.join(root, 'nginx.conf'), 'utf8');

  assert.doesNotMatch(nginxConfig, /https:\/\/\$host\$request_uri/);
  assert.match(nginxConfig, /return\s+301\s+https:\/\/\$\{SITE_DOMAIN\}\$request_uri;/);
});

test('nginx proxy image is immutable because it receives the TLS private key', () => {
  const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
  const nginxService = getComposeServiceBlock(compose, 'nginx');
  const imageMatch = nginxService.match(/^    image:\s*(\S+)\s*$/m);

  assert.ok(imageMatch, 'nginx service should declare an image');
  assert.match(nginxService, /\$\{CERT_PRIVKEY_PATH\}:\/etc\/nginx\/certs\/privkey\.pem:ro/);
  assert.doesNotMatch(imageMatch[1], /:latest(?:$|@)/);
  assert.match(imageMatch[1], /@sha256:[a-f0-9]{64}$/);
});

test('nginx sets browser hardening headers on proxied responses', () => {
  const nginxConfig = fs.readFileSync(path.join(root, 'nginx.conf'), 'utf8');
  const cspMatch = nginxConfig.match(/add_header\s+Content-Security-Policy\s+"([^"]+)"\s+always;/);
  const csp = cspMatch ? cspMatch[1] : '';
  const scriptSrc = csp
    .split(';')
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith('script-src'));

  assert.ok(cspMatch, 'nginx should set a CSP header with always');
  assert.equal(scriptSrc, "script-src 'self'");
  assert.match(nginxConfig, /add_header\s+Strict-Transport-Security\s+"max-age=31536000; includeSubDomains"\s+always;/);
  assert.match(nginxConfig, /add_header\s+X-Content-Type-Options\s+"nosniff"\s+always;/);
  assert.match(nginxConfig, /add_header\s+X-Frame-Options\s+"DENY"\s+always;/);
  assert.match(nginxConfig, /add_header\s+Referrer-Policy\s+"strict-origin-when-cross-origin"\s+always;/);
  assert.match(nginxConfig, /add_header\s+Permissions-Policy\s+"[^"]*camera=\(\)[^"]*"\s+always;/);
});
