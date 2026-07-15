require('dotenv').config();
const cors = require('cors');
const si = require('systeminformation');
const express = require("express");
const keycloak = require('./keycloak');
const fs = require('fs');
const Tail = require('tail').Tail;
var https = require('https');

shieldSettings = require('/etc/bosca/settings.json');

const port = 3008;

const errorHandler = (error, req, res, next) => {
  const status = error.status || 422;
  res.status(status).send(error.message);
}

const app = express();

app.use(keycloak.middleware());
app.use(express.json());
app.use(cors());
app.use(errorHandler);

const server = require('http').createServer(app);
const io = require('socket.io')(server, {
  cors: {
      origin: "*"
  }
});

var clients = 0;

const LOG_DIR = '/etc/bosca/logs';
const LOG_SOURCES = [
  'log-server-net2',
  'log-server-suprema',
  'messaging-endpoint',
  'webapi',
];

// Poll for log files that don't exist yet (e.g. right after a date rollover)
// before giving up. Prevents crashing when a day's log hasn't been created.
const FILE_RETRY_MS = 10000;
// How often to check whether the calendar day has rolled over.
const ROLLOVER_CHECK_MS = 60000;
// Max time to wait on the Net2 API hub before treating it as unavailable, so
// an unreachable hub can't stall the /metrics response indefinitely.
const NET2_TIMEOUT_MS = 5000;

let activeTails = [];
let currentDay = null;

function dayStamp(date = new Date()) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function stopTails() {
  for (const tail of activeTails) {
    try {
      tail.unwatch();
    } catch (error) {
      console.log('Failed to unwatch tail: ', error);
    }
  }
  activeTails = [];
}

// Start tailing a single file. If it doesn't exist yet (the Tail constructor
// throws on a missing file), retry until it appears — as long as we're still
// on the same day it was scheduled for.
function tailFile(filePath, day) {
  if (day !== currentDay) {
    return;
  }

  if (!fs.existsSync(filePath)) {
    setTimeout(() => tailFile(filePath, day), FILE_RETRY_MS);
    return;
  }

  try {
    const tail = new Tail(filePath, { follow: true });
    tail.on('line', function(data) {
      io.emit('log', data);
    });
    tail.on('error', function(error) {
      console.log('Tail ERROR: ', filePath, error);
    });
    activeTails.push(tail);
    console.log('Tailing ', filePath);
  } catch (error) {
    console.log('Failed to start tail, will retry: ', filePath, error.message);
    setTimeout(() => tailFile(filePath, day), FILE_RETRY_MS);
  }
}

// (Re)initialise the tails for the current calendar day.
function startTailsForToday() {
  stopTails();
  currentDay = dayStamp();
  for (const source of LOG_SOURCES) {
    tailFile(`${LOG_DIR}/${source}-${currentDay}.log`, currentDay);
  }
}

startTailsForToday();

// Re-create the tails when the date changes so we always follow today's logs.
setInterval(function() {
  if (dayStamp() !== currentDay) {
    console.log('Date rollover detected, reinitialising log tails');
    startTailsForToday();
  }
}, ROLLOVER_CHECK_MS);

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

app.get("/metrics", [keycloak.protect()], async ( req, res, next) => {
  si.getDynamicData(function(data) {
    si.osInfo(function(osInfo) {
      data.osInfo = osInfo;
      shieldVersion = require('/etc/bosca/version.json');
      data.siteVersion = shieldVersion.version;
        // Respond even if the Net2 hub is unreachable. Without a timeout a
        // hanging connection (host down / network change) leaves the request
        // open forever and the whole metrics view — including logs — never
        // loads. 'error' only fires on refused/DNS failures, not silent hangs.
        try {
          const net2Req = https.get(shieldSettings.Net2ApiHubBaseURL, { timeout: NET2_TIMEOUT_MS }, function(response) {
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

server.listen(port, function() {
  console.log(`Listening on port ${port}`);
});