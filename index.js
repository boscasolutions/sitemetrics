require('dotenv').config();
const keycloak = require('./keycloak');
const { createApp } = require('./app');
const { createLogStreamer } = require('./logs');

const shieldSettings = require('/etc/bosca/settings.json');

const port = 3008;

const { server, io } = createApp({ keycloak, settings: shieldSettings });

createLogStreamer({ io }).start();

server.listen(port, function() {
  console.log(`Listening on port ${port}`);
});
