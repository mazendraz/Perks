import { z } from 'zod';

// Configure before importing modules that construct shared schemas. The web
// policy forbids eval, including a caught feature probe from a JIT parser.
z.config({ jitless: true });
