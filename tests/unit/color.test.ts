import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexToHsv, hsvToHex } from '../../apps/web/src/controls/color.js';
test('custom color picker preserves exact HEX colors through HSV including neutral and hue boundaries', () => {
  for (const color of [
    '#000000',
    '#FFFFFF',
    '#FF0000',
    '#00FF00',
    '#0000FF',
    '#204C41',
    '#D4AD68',
    '#F9F5EA',
    '#777777',
    '#F50004',
  ])
    assert.equal(hsvToHex(hexToHsv(color)), color);
});
