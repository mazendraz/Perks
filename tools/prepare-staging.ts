import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { privateLocalDirectory } from './private-local.js';
import { stagingEnvironmentText, stagingReviewEnvironment } from './staging-config.js';
const path = resolve(await privateLocalDirectory('staging-review'), '.env.staging');
await writeFile(path, stagingEnvironmentText(stagingReviewEnvironment()), {
  flag: 'wx',
  mode: 0o600,
});
console.log('Private staging review file: ' + path);
console.log(
  'Independent secrets generated. Existing files are never overwritten. No deployment was started; host, DNS, SMTP and TLS are still required.',
);
