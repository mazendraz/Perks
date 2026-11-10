import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Login } from '../../apps/web/src/features/Auth.js';

test('login marketing and sample card follow the selected language in the actual rendered screen', () => {
  const render = (lang: 'ar' | 'en') =>
    renderToStaticMarkup(
      createElement(Login, {
        lang,
        onSuccess: async () => {},
      }),
    );
  const ar = render('ar');
  for (const text of ['نادي الصباح', 'نور أحمد', 'قهوتك الجاية علينا.', 'معاك في كل زيارة.'])
    assert.ok(ar.includes(text), text);
  for (const text of [
    'MORNING CLUB',
    'NOUR AHMED',
    'Your next coffee',
    'A little ritual',
    'GOOD VISITS',
    'MADE FOR YOUR',
  ])
    assert.ok(!ar.includes(text), text);
  const en = render('en');
  assert.ok(en.includes('MORNING CLUB'));
  assert.ok(en.includes('Closer to your reward'));
  assert.ok(!en.includes('أقرب للمكافأة'));
});
