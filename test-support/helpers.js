'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');
const Keycloak = require('keycloak-connect');
const { createApp } = require('../app');

const REALM = 'test-realm';
const AUTH_SERVER_URL = 'http://127.0.0.1:1/auth';
const CLIENT_ID = 'sitemetrics-test';

/**
 * A real keycloak-connect instance in bearer-only mode, configured with a static
 * realm public key so it verifies tokens offline (no Keycloak server needed).
 * Same options shape as keycloak.js uses in production.
 */
function createKeycloakFixture() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const realmPublicKey = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

  const keycloak = new Keycloak({}, {
    realm: REALM,
    'auth-server-url': AUTH_SERVER_URL,
    'ssl-required': 'external',
    resource: CLIENT_ID,
    'bearer-only': true,
    'realm-public-key': realmPublicKey,
  });

  function signToken({ key = privateKey, claims = {} } = {}) {
    const payload = {
      typ: 'Bearer',
      iss: `${AUTH_SERVER_URL}/realms/${REALM}`,
      azp: CLIENT_ID,
      sub: 'test-user',
      ...claims,
    };
    if (payload.exp === undefined) {
      payload.exp = Math.floor(Date.now() / 1000) + 300;
    }
    return jwt.sign(payload, key, { algorithm: 'RS256' });
  }

  return { keycloak, signToken };
}

function writeVersionFile(version = '9.9.9-test') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitemetrics-version-'));
  const file = path.join(dir, 'version.json');
  fs.writeFileSync(file, JSON.stringify({ version }));
  return { file, dir };
}

/** Starts the app on an ephemeral port and returns helpers to talk to and stop it. */
async function startApp(options) {
  const { server, io } = createApp(options);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    io,
    server,
    async stop() {
      // io.close() also closes the underlying http server.
      await new Promise((resolve) => {
        io.close(() => resolve());
        if (server.closeAllConnections) {
          server.closeAllConnections();
        }
      });
    },
  };
}

function waitFor(emitter, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
    emitter.once(event, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

module.exports = {
  CLIENT_ID,
  REALM,
  createKeycloakFixture,
  startApp,
  waitFor,
  writeVersionFile,
};
