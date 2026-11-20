/* global self,caches,fetch,URL,Response */
const VERSION = '__NUQTA_VERSION__';
const CACHE = 'nuqta-shell-' + VERSION;
const META = 'nuqta-meta';
const SHELL = /*__NUQTA_SHELL__*/[];
const ALLOWED = /*__NUQTA_ALLOWED__*/[];
self.addEventListener('install', event => {
  // Activate as soon as the shell is cached; pages pick up the new release on their own
  // next navigation or while hidden (see src/update-gate.ts), never by prompting.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    // Keep exactly one preceding shell (the release this worker replaces) for tabs still
    // running it; delete every older one. The replaced release is recorded explicitly
    // because a cache can exist for a release that never activated.
    const meta=await caches.open(META),recorded=await meta.match('/active');
    const keys=(await caches.keys()).filter(key=>key.startsWith('nuqta-shell-') && key!==CACHE);
    let previous=recorded ? 'nuqta-shell-'+(await recorded.text()) : null;
    if(previous===CACHE || (previous && !keys.includes(previous)))previous=null;
    // Releases from before the record existed: caches.keys() lists in creation order.
    if(!previous && !recorded)previous=keys[keys.length-1] || null;
    await Promise.all(keys.filter(key=>key!==previous).map(key=>caches.delete(key)));
    await meta.put('/active',new Response(VERSION));
    await self.clients.claim();
  })());
});
/* Cashier notifications (Web Push). The payload is composed by the server and is generic by design:
   { title, body, url, tag, lang, dir } where body is a branch name. Nothing here is cached or trusted
   beyond showing it; a tap only ever opens a same-origin cashier page. */
self.addEventListener('push', event => {
  const data = (() => { try { return (event.data && event.data.json()) || {}; } catch { return {}; } })();
  const text = value => (typeof value === 'string' ? value.slice(0, 200) : '');
  const options = {
    body: text(data.body),
    icon: '/icons/perks-192.png',
    badge: '/icons/perks-192.png',
    lang: data.lang === 'en' ? 'en' : 'ar',
    dir: data.dir === 'ltr' ? 'ltr' : 'rtl',
    data: { url: typeof data.url === 'string' ? data.url : '/cashier' }
  };
  // The same tag replaces the earlier notification instead of stacking, and still buzzes.
  if(typeof data.tag === 'string' && data.tag) { options.tag = text(data.tag); options.renotify = true; }
  // A push that shows nothing makes the browser show its own generic notice, so always show one.
  event.waitUntil(self.registration.showNotification(text(data.title) || 'Perks', options));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  let target = new URL('/cashier', self.location.origin);
  try {
    const wanted = new URL((event.notification.data && event.notification.data.url) || '/cashier', self.location.origin);
    if(wanted.origin === self.location.origin && /^\/cashier(?:\/|$)/.test(wanted.pathname)) target = wanted;
  } catch { /* keep the default */ }
  event.waitUntil((async()=>{
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for(const client of windows) {
      if(new URL(client.url).origin === self.location.origin && /^\/cashier(?:\/|$)/.test(new URL(client.url).pathname)) {
        await client.focus();
        return client.url === target.href || !('navigate' in client) ? undefined : client.navigate(target.href);
      }
    }
    return self.clients.openWindow(target.href);
  })());
});
/* The push service replaced this browser's subscription (its keys rotated or it expired). Subscribe again
   with the same server key so the browser keeps a valid one, then ask an open page to register it: the
   worker cannot read the session's CSRF token, so the page does the authenticated part (or the next visit). */
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async()=>{
    try {
      const key = (event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey) || undefined;
      if(key) await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    } catch { /* permission revoked: the next visit shows the button again */ }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for(const client of windows) client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
  })());
});
self.addEventListener('fetch', event => {
  const request=event.request,url=new URL(request.url);
  // API, auth, health, methods and query-bearing asset requests always use the network.
  if(request.method!=='GET' || url.origin!==self.location.origin || /^\/(?:api|health|internal)(?:\/|$)/.test(url.pathname))return;
  if(request.mode==='navigate') {
    // Online page loads go straight to the network. Safari drops same-site cookies on a page
    // a service worker answered after a QR/NFC/Wallet open, which made returning customers
    // look new. The worker only steps in when the phone is offline.
    if(self.navigator.onLine!==false)return;
    event.respondWith(fetch(request).catch(async()=>{
      const cache=await caches.open(CACHE);
      return (await cache.match('/index.html')) || (await cache.match('/offline.html')) || new Response('<!doctype html><html lang="ar" dir="rtl"><meta charset="UTF-8"><p>مفيش نت دلوقتي. وصّل النت وجرب تاني.</p><p lang="en" dir="ltr">You are offline. Reconnect and try again.</p></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'"}});
    }));
    return;
  }
  if(url.search)return;
  if(!ALLOWED.includes(url.pathname)) {
    // A tab claimed mid-session still runs the previous release; serve its lazy chunks
    // from the preceding shell cache when they are no longer on the server.
    if(url.pathname.startsWith('/assets/'))event.respondWith(caches.match(url.pathname).then(hit=>hit||fetch(request)));
    return;
  }
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE),cached=await cache.match(url.pathname);
    if(cached)return cached;
    const response=await fetch(request);
    if(response.ok && response.type!=='opaque')await cache.put(url.pathname,response.clone());
    return response;
  })());
});
