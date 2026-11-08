import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLanguage } from '../../apps/web/src/locale.js';
test('first visit follows the primary device language; explicit user choices take precedence', () => {
  assert.equal(resolveLanguage(null, 'ar-EG'), 'ar');
  assert.equal(resolveLanguage(null, 'ar-SA'), 'ar');
  assert.equal(resolveLanguage(null, 'en-US'), 'en');
  assert.equal(resolveLanguage(null, 'fr-FR'), 'en');
  assert.equal(resolveLanguage('ar', 'en-US'), 'ar');
  assert.equal(resolveLanguage('en', 'ar-EG'), 'en');
  assert.equal(resolveLanguage('invalid', 'ar'), 'ar');
});
