'use strict';

const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { io: connect } = require('socket.io-client');
const { createKeycloakFixture, startApp, waitFor } = require('../test-support/helpers');

describe('socket.io server', () => {
  let app;

  before(async () => {
    app = await startApp({
      keycloak: createKeycloakFixture().keycloak,
      settings: { Net2ApiHubBaseURL: 'https://127.0.0.1:1/' },
    });
  });

  after(async () => {
    await app.stop();
  });

  it('accepts a websocket client and delivers log events to it', async () => {
    const client = connect(app.baseUrl, { transports: ['websocket'], reconnection: false });

    try {
      await waitFor(client, 'connect');

      const received = waitFor(client, 'log');
      app.io.emit('log', 'hello from the server');

      assert.equal(await received, 'hello from the server');
    } finally {
      client.close();
    }
  });

  it('accepts a long-polling client, the transport browsers start with', async () => {
    const client = connect(app.baseUrl, { transports: ['polling'], reconnection: false });

    try {
      await waitFor(client, 'connect');

      assert.equal(client.connected, true);
    } finally {
      client.close();
    }
  });

  it('allows cross-origin handshakes', async () => {
    const response = await fetch(`${app.baseUrl}/socket.io/?EIO=4&transport=polling`, {
      headers: { Origin: 'https://app.example.com' },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
  });
});
