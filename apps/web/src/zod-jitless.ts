// Every `import ... from 'zod'` in the web build resolves here (see vite.config.ts), so Zod is
// configured before ANY schema is constructed, whatever order the production chunks evaluate in.
// Zod decides at schema construction whether to probe `new Function`, which the strict CSP
// forbids (and reports) even though Zod catches the failure.
import { z } from 'zod/v4';
z.config({ jitless: true });
export * from 'zod/v4';
export { z };
export default z;
