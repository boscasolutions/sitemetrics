'use strict';

const http = require('http');
const https = require('https');
const cors = require('cors');
const express = require('express');
const si = require('systeminformation');
const { Server } = require('socket.io');

// Max time to wait on the Net2 API hub before treating it as unavailable, so
// an unreachable hub can't stall the /metrics response indefinitely.
const NET2_TIMEOUT_MS = 5000;

const errorHandler = (error, req, res, next) => {
  const status = error.status || 422;
  res.status(status).send(error.message);
};

/**
 * Builds the HTTP + socket.io server without listening or reading any files at
 * import time, so tests can run the same stack against a throwaway port.
 *
 * @param {object} options
 * @param {object} options.keycloak  A keycloak-connect instance (middleware() and protect()).
 * @param {object} options.settings  Site settings; only Net2ApiHubBaseURL is used.
 * @param {string} [options.versionFilePath]  JSON file holding { "version": "..." }.
 * @param {number} [options.net2TimeoutMs]
 */
function createApp({
  keycloak,
  settings,
  versionFilePath = '/etc/bosca/version.json',
  net2TimeoutMs = NET2_TIMEOUT_MS,
}) {
  const app = express();

  app.use(keycloak.middleware());
  app.use(express.json());
  app.use(cors());
  app.use(errorHandler);

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: '*',
    },
  });

  let clients = 0;

  io.on('connection', (socket) => {
    clients++;
    console.log('Client connected. Active clients: ', clients);

    socket.on('disconnect', function() {
      clients--;
      console.log('Client disconnected. Active clients: ', clients);
    });

    socket.on('error', function(error) {
      console.log('Socket ERROR: ', error);
    });
  });

  app.get('/metrics', [keycloak.protect()], async (req, res, next) => {
    si.getDynamicData(function(data) {
      si.osInfo(function(osInfo) {
        data.osInfo = osInfo;
        const shieldVersion = require(versionFilePath);
        data.siteVersion = shieldVersion.version;
        // Respond even if the Net2 hub is unreachable. Without a timeout a
        // hanging connection (host down / network change) leaves the request
        // open forever and the whole metrics view - including logs - never
        // loads. 'error' only fires on refused/DNS failures, not silent hangs.
        try {
          const net2Req = https.get(settings.Net2ApiHubBaseURL, { timeout: net2TimeoutMs }, function(response) {
            data.net2Status = response.statusCode;
            if (!res.headersSent) res.json(data);
          });
          net2Req.on('timeout', function() {
            net2Req.destroy();
          });
          net2Req.on('error', function(e) {
            data.net2Status = 400;
            if (!res.headersSent) res.json(data);
          });
        } catch (error) {
          data.net2Status = 400;
          if (!res.headersSent) res.json(data);
        }
      });
    });
  });

  return { app, server, io };
}

module.exports = { createApp, NET2_TIMEOUT_MS };
