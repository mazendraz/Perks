// Zod is configured jitless in ./zod-jitless.ts, which the Vite build substitutes for every
// "zod" import so the setting is in place before any shared schema is constructed. Importing
// it here as well keeps the setting explicit for the entry and for non-Vite consumers.
import './zod-jitless.js';
