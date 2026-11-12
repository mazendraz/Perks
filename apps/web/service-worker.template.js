/* global self,caches,fetch,URL,Response */
const VERSION = '__NUQTA_VERSION__';
const CACHE = 'nuqta-shell-' + VERSION;
const SHELL = /*__NUQTA_SHELL__*/[];
const ALLOWED = /*__NUQTA_ALLOWED__*/[];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('message', event => {
  if(event.data && event.data.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    const keys=(await caches.keys()).filter(key=>key.startsWith('nuqta-shell-') && key!==CACHE);
    // Keep one preceding shell for existing tabs; bound disk use across releases.
    await Promise.all(keys.slice(0,-1).map(key=>caches.delete(key)));
    await self.clients.claim();
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
  if(url.search || !ALLOWED.includes(url.pathname))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE),cached=await cache.match(url.pathname);
    if(cached)return cached;
    const response=await fetch(request);
    if(response.ok && response.type!=='opaque')await cache.put(url.pathname,response.clone());
    return response;
  })());
});
