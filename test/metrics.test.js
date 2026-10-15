'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const { after, before, describe, it } = require('node:test');
const { createKeycloakFixture, startApp, writeVersionFile } = require('../test-support/helpers');

// Net2 hub that refuses connections (nothing listens on port 1).
const UNREACHABLE_NET2 = 'https://127.0.0.1:1/';

describe('GET /metrics', () => {
  const fixture = createKeycloakFixture();
  const version = writeVersionFile('9.9.9-test');
  let app;

  before(async () => {
    app = await startApp({
      keycloak: fixture.keycloak,
      settings: { Net2ApiHubBaseURL: UNREACHABLE_NET2 },
      versionFilePath: version.file,
    });
  });

  after(async () => {
    await app.stop();
  });

  const get = (token) =>
    fetch(`${app.baseUrl}/metrics`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);

  it('rejects a request with no token', async () => {
    const response = await get();

    assert.ok([401, 403].includes(response.status), `unexpected status ${response.status}`);
  });

  it('rejects a token signed by a different key', async () => {
    const other = createKeycloakFixture();

    const response = await get(other.signToken());

    assert.ok([401, 403].includes(response.status), `unexpected status ${response.status}`);
  });

  it('rejects an expired token', async () => {
    const expired = fixture.signToken({ claims: { exp: Math.floor(Date.now() / 1000) - 60 } });

    const response = await get(expired);

    assert.ok([401, 403].includes(response.status), `unexpected status ${response.status}`);
  });

  it('rejects a token from another realm', async () => {
    const wrongIssuer = fixture.signToken({ claims: { iss: 'http://127.0.0.1:1/auth/realms/other' } });

    const response = await get(wrongIssuer);

    assert.ok([401, 403].includes(response.status), `unexpected status ${response.status}`);
  });

  it('returns system metrics for a valid token', async () => {
    const response = await get(fixture.signToken());

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);

    const body = await response.json();

    assert.equal(body.siteVersion, '9.9.9-test');
    assert.equal(typeof body.mem.total, 'number');
    assert.ok(body.osInfo && typeof body.osInfo.platform === 'string');
  });

  it('reports the Net2 hub as unavailable (400) when it refuses connections', async () => {
    const body = await (await get(fixture.signToken())).json();

    assert.equal(body.net2Status, 400);
  });

  it('allows cross-origin callers', async () => {
    const response = await fetch(`${app.baseUrl}/metrics`, {
      headers: { Authorization: `Bearer ${fixture.signToken()}`, Origin: 'https://app.example.com' },
    });

    assert.equal(response.headers.get('access-control-allow-origin'), '*');
  });

  it('answers unknown routes with 404', async () => {
    const response = await fetch(`${app.baseUrl}/does-not-exist`);

    assert.equal(response.status, 404);
  });

  it('answers a malformed JSON body with 400 through the error handler', async () => {
    const response = await fetch(`${app.baseUrl}/metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });

    assert.equal(response.status, 400);
  });
});

describe('GET /metrics when the Net2 hub hangs', () => {
  const fixture = createKeycloakFixture();
  const version = writeVersionFile();
  let app;
  let hangingHub;
  let hubPort;

  before(async () => {
    // Accepts the TCP connection and then says nothing, like a host that went down mid-handshake.
    const sockets = new Set();
    hangingHub = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    hangingHub.destroyAll = () => sockets.forEach((socket) => socket.destroy());

    await new Promise((resolve) => hangingHub.listen(0, '127.0.0.1', resolve));
    hubPort = hangingHub.address().port;

    app = await startApp({
      keycloak: fixture.keycloak,
      settings: { Net2ApiHubBaseURL: `https://127.0.0.1:${hubPort}/` },
      versionFilePath: version.file,
      net2TimeoutMs: 300,
    });
  });

  after(async () => {
    await app.stop();
    hangingHub.destroyAll();
    await new Promise((resolve) => hangingHub.close(resolve));
  });

  it('still responds, with net2Status 400, once the timeout fires', async () => {
    const started = Date.now();

    const response = await fetch(`${app.baseUrl}/metrics`, {
      headers: { Authorization: `Bearer ${fixture.signToken()}` },
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).net2Status, 400);
    assert.ok(Date.now() - started < 10000, 'response was not bounded by the Net2 timeout');
  });
});
