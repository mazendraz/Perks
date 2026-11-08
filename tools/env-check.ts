import { readConfig } from '../apps/api/src/config.js';
const c = readConfig();
console.log(
  JSON.stringify({
    environment: c.APP_ENV,
    authProvider: c.AUTH_PROVIDER,
    configValid: true,
    secretsPrinted: false,
  }),
);
