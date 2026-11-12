import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceMeters,
  parseMapsPosition,
  SHORT_MAPS_LINK,
  GOOGLE_MAPS_HOST,
} from '../../packages/domain/src/geo.js';

test('branch positions are read from pasted coordinates and every common Google Maps link', () => {
  const at = { latitude: 30.0444, longitude: 31.2357 };
  for (const input of [
    '30.0444, 31.2357',
    '30.0444,31.2357',
    ' 30.0444 31.2357 ',
    '30.0444، 31.2357',
    'https://www.google.com/maps?q=30.0444,31.2357',
    'https://maps.google.com/?q=30.0444%2C31.2357',
    'https://www.google.com/maps/search/?api=1&query=30.0444,31.2357',
    'https://www.google.com/maps/search/30.0444,+31.2357?entry=tts',
    'https://www.google.com/maps/@30.0444,31.2357,17z',
    // The pin wins over the map centre.
    'https://www.google.com/maps/place/Cafe/@30.1,31.3,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d30.0444!4d31.2357!16s',
  ])
    assert.deepEqual(parseMapsPosition(input), at, input);
  for (const input of ['', 'Cairo', '95, 31', '30.0, 190', '0, 0', 'https://maps.app.goo.gl/abcd'])
    assert.equal(parseMapsPosition(input), null, input);
});
test('only Google short links are resolved, and redirects stay on Google hosts', () => {
  assert.ok(SHORT_MAPS_LINK.test('https://maps.app.goo.gl/AbC123xyz'));
  assert.ok(SHORT_MAPS_LINK.test('https://maps.app.goo.gl/AbC123xyz?g_st=iw'));
  assert.ok(SHORT_MAPS_LINK.test('https://goo.gl/maps/AbC123xyz'));
  for (const bad of [
    'http://maps.app.goo.gl/AbC123xyz',
    'https://maps.app.goo.gl.evil.test/AbC123xyz',
    'https://evil.test/maps.app.goo.gl/AbC123xyz',
    'https://maps.app.goo.gl/../../x',
  ])
    assert.equal(SHORT_MAPS_LINK.test(bad), false, bad);
  for (const host of ['www.google.com', 'maps.google.com', 'www.google.com.eg', 'maps.app.goo.gl'])
    assert.ok(GOOGLE_MAPS_HOST.test(host), host);
  for (const host of ['google.com.evil.test', 'evilgoogle.com', '127.0.0.1', 'localhost'])
    assert.equal(GOOGLE_MAPS_HOST.test(host), false, host);
});
test('distance is symmetric and zero at the same point', () => {
  assert.equal(distanceMeters(30, 31, 30, 31), 0);
  const a = distanceMeters(30.0444, 31.2357, 30.045, 31.236),
    b = distanceMeters(30.045, 31.236, 30.0444, 31.2357);
  assert.ok(Math.abs(a - b) < 1e-9 && a > 60 && a < 80, String(a));
});
