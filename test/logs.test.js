'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, beforeEach, describe, it } = require('node:test');
const { io: connect } = require('socket.io-client');
const { dayStamp, createLogStreamer } = require('../logs');
const { createKeycloakFixture, startApp, waitFor } = require('../test-support/helpers');

const SOURCE = 'messaging-endpoint';

describe('dayStamp', () => {
  it('formats a date as yyyymmdd in UTC', () => {
    assert.equal(dayStamp(new Date('2026-10-15T23:59:59Z')), '20261015');
  });
});

describe('log streaming over socket.io', () => {
  let app;
  let client;
  let streamer;
  let logDir;

  beforeEach(async () => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitemetrics-logs-'));
    app = await startApp({
      keycloak: createKeycloakFixture().keycloak,
      settings: { Net2ApiHubBaseURL: 'https://127.0.0.1:1/' },
    });
    client = connect(app.baseUrl, { transports: ['websocket'], reconnection: false });
    await waitFor(client, 'connect');
  });

  afterEach(async () => {
    streamer?.stop();
    client.close();
    await app.stop();
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  const logFile = () => path.join(logDir, `${SOURCE}-${dayStamp()}.log`);

  /** Appends a numbered line every 100 ms until the client sees one, so the test does not race Tail's startup. */
  async function expectStreamedLine() {
    const received = waitFor(client, 'log', 8000);
    let n = 0;
    const writer = setInterval(() => fs.appendFileSync(logFile(), `line-${++n}\n`), 100);

    try {
      return await received;
    } finally {
      clearInterval(writer);
    }
  }

  it('emits new lines from an existing log file as log events', async () => {
    fs.writeFileSync(logFile(), 'old line\n');
    streamer = createLogStreamer({ io: app.io, logDir, sources: [SOURCE], fileRetryMs: 100, rolloverCheckMs: 60000 });
    streamer.start();

    const line = await expectStreamedLine();

    assert.match(line, /^line-\d+$/);
  });

  it('picks up a log file that is created after start', async () => {
    streamer = createLogStreamer({ io: app.io, logDir, sources: [SOURCE], fileRetryMs: 100, rolloverCheckMs: 60000 });
    streamer.start();

    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.writeFileSync(logFile(), 'created later\n');

    const line = await expectStreamedLine();

    assert.match(line, /^line-\d+$/);
  });

  it('stops streaming after stop()', async () => {
    fs.writeFileSync(logFile(), 'old line\n');
    streamer = createLogStreamer({ io: app.io, logDir, sources: [SOURCE], fileRetryMs: 100, rolloverCheckMs: 60000 });
    streamer.start();
    await expectStreamedLine();

    streamer.stop();

    const lines = [];
    client.on('log', (line) => lines.push(line));
    fs.appendFileSync(logFile(), 'after-stop\n');
    await new Promise((resolve) => setTimeout(resolve, 500));

    assert.deepEqual(lines, []);
  });
});
