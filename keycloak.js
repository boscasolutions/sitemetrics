const Keycloak = require("keycloak-connect");

keycloakSettings = require('/etc/bosca/keycloak.json');

const config = {
  "realm": keycloakSettings.realm,
  "auth-server-url": keycloakSettings.auth-server-url,
  "ssl-required": "external",
  "resource": keycloakSettings.resource,
  "bearer-only": true
}

// const config = {
//   "realm": process.env.KEYCLOAK_REALM,
//   "auth-server-url": `${process.env.KEYCLOAK_URL}`,
//   "ssl-required": "external",
//   "resource": process.env.KEYCLOAK_CLIENT,
//   "bearer-only": true
// }

module.exports = new Keycloak({}, config);