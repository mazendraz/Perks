import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// User-facing Arabic copy must keep words, numbers and punctuation separated.
// Glued words ("أوغير", "اللي‌بعده") and digits ("صالحة30يوم") read as typos to shop
// owners and customers, so the source is checked for the patterns found in the journey.
const roots = ['apps/web/src', 'apps/api/src', 'packages/ui/src', 'packages/contracts/src', 'db'];
const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx)$/.test(name)) files.push(path);
  }
};
roots.forEach(walk);
const arabic = 'ء-ي';
const checks: [string, RegExp][] = [
  ['Arabic comma or semicolon without a following space', new RegExp(`[،؛][${arabic}]`)],
  ['Arabic letter glued to a Latin digit', new RegExp(`[${arabic}][0-9]|[0-9][${arabic}]`)],
  [
    'أو glued to the next word',
    new RegExp(`(^|[\\s'"«(])أو(?!ل|لى|ضح|قات|قف|توماتيك|راق|امر|ردر|نلاين|عى|ضة|كي|ي)[${arabic}]`),
  ],
  // «اللينك» (the link) is an ordinary Egyptian loanword and «الليرة» (the lira) a currency,
  // not اللي glued to a word.
  ['اللي glued to the next word', new RegExp(`اللي(?!ل|مون|نك|رة)[${arabic}]`)],
  ['في glued to a definite noun', new RegExp(`(^|[\\s'"«(])فيال`)],
];
test('the glued-word checks flag real mistakes and leave ordinary words alone', () => {
  const flagged = (text: string) => checks.some(([, pattern]) => pattern.test(text));
  for (const ok of ['ابعت اللينك للعميل', 'اللي ليهم كروت', 'الليرة التركية', 'أولاً', 'في المحل'])
    assert.equal(flagged(ok), false, ok);
  for (const bad of ['اللياشتركوا', 'فيالمحل', 'أوكارت', 'محل،فرع'])
    assert.equal(flagged(bad), true, bad);
});
test('Arabic interface copy keeps words, numbers and punctuation separated', () => {
  const problems: string[] = [];
  for (const file of files) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (!new RegExp(`[${arabic}]`).test(line)) return;
        for (const [label, pattern] of checks)
          if (pattern.test(line)) problems.push(`${file}:${index + 1} ${label}: ${line.trim()}`);
      });
  }
  assert.deepEqual(problems, []);
});
