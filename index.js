require('dotenv').config();
const cors = require('cors');
const si = require('systeminformation');
const express = require("express");
const keycloak = require('./keycloak');
Tail = require('tail').Tail;
var https = require('https');

shieldSettings = require('/etc/bosca/settings.json');

const port = 3008;

var rightNow = new Date();
var today = rightNow.toISOString().slice(0,10).replace(/-/g,"");

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

tail1 = new Tail(`/etc/bosca/logs/log-server-net2-${today}.log`);
tail2 = new Tail(`/etc/bosca/logs/log-server-suprema-${today}.log`);
tail3 = new Tail(`/etc/bosca/logs/messaging-endpoint-${today}.log`);
tail4 = new Tail(`/etc/bosca/logs/webapi-${today}.log`);

tail1.on("line", function(data) {
  io.emit('log', data);
});
tail2.on("line", function(data) {
  io.emit('log', data);
});
tail3.on("line", function(data) {
  io.emit('log', data);
});
tail4.on("line", function(data) {
  io.emit('log', data);
});

tail1.on("error", function(error) {
  console.log('ERROR: ', error);
});
tail2.on("error", function(error) {
  console.log('ERROR: ', error);
});
tail3.on("error", function(error) {
  console.log('ERROR: ', error);
});
tail4.on("error", function(error) {
  console.log('ERROR: ', error);
});

io.on('connect', (socket) => {
  console.log('Client connected');
  if(clients == 0) {
    tail1.watch()
    tail2.watch()
    tail3.watch()
    tail4.watch()
  }
  clients++;
})

io.on('error', function(error) {
  console.log('ERROR: ', error);
});

io.on('disconnect', function () {
  console.log('Client disconnected');
  clients--;
  if(clients == 0) {
    tail1.unwatch()
    tail2.unwatch()
    tail3.unwatch()
    tail4.unwatch()
  }
});

app.get("/metrics", [keycloak.protect()], async ( req, res, next) => {
  si.getDynamicData(function(data) {
    si.osInfo(function(osInfo) {
      data.osInfo = osInfo;
      shieldVersion = require('/etc/bosca/version.json');
      data.siteVersion = shieldVersion.version;
        try {
          https.get(shieldSettings.Net2ApiHubBaseURL, function(response) {
            data.net2Status = response.statusCode;
            res.json(data);
          }).on('error', function(e) {
            data.net2Status = 400;
            res.json(data);
          });
        } catch (error) {
          data.net2Status = 400;
          res.json(data);
        }
    });
  });
});

server.listen(port, function() {
  console.log(`Listening on port ${port}`);
});