require('dotenv').config();
const cors = require('cors');
const si = require('systeminformation');
const express = require("express");
const keycloak = require('./keycloak');

const port = 3008;

shieldVersion = require('/etc/bosca/version.json');

const errorHandler = (error, req, res, next) => {
  const status = error.status || 422;
  res.status(status).send(error.message);
}

const app = express();

app.use(keycloak.middleware());
app.use(express.json());
app.use(cors());

app.use(errorHandler);

app.listen(port, () => {
  console.log("Server running on port 3008");
});

// app.get("/stats", (req, res, next) => {
//   si.processLoad(function(data) {
//       res.json(data);
//   });
// });

app.get("/metrics", [keycloak.protect()], async ( req, res, next) => {
  si.getDynamicData(function(data) {
    si.osInfo(function(osInfo) {
      data.osInfo = osInfo;
      data.siteVersion = shieldVersion.version;
      res.json(data);
    });
  });
});