// Prints a fresh VAPID key pair for Web Push. Paste both lines into the API and worker environment.
// The pair must never change once phones have subscribed: every browser holds the public half.
import { generateVapidKeys } from '../apps/api/src/webpush.js';
const keys = generateVapidKeys();
console.log('WEB_PUSH_VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('WEB_PUSH_VAPID_PRIVATE_KEY=' + keys.privateKey);
