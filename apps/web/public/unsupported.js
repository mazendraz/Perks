/* global document,navigator,window,localStorage,setTimeout */
(function () {
  var ua = navigator.userAgent,
    ios = ua.match(/(?:CPU(?: iPhone)? OS|iPhone OS) (\d+)_/),
    android = ua.match(/Android (\d+)/),
    samsung = ua.match(/SamsungBrowser\/(\d+)/),
    chrome = ua.match(/(?:Chrome|Chromium)\/(\d+)/),
    safari = !chrome && !android && ua.match(/Version\/(\d+).*Safari\//);
  var old = !!(
    (ios && +ios[1] < 13) ||
    (android && +android[1] < 8) ||
    (samsung && +samsung[1] < 12) ||
    (!samsung && chrome && +chrome[1] < 80) ||
    (safari && +safari[1] < 13) ||
    /MSIE|Trident\//.test(ua)
  );
  window.__nuqtaUnsupported = old;
  var lang = (navigator.languages && navigator.languages[0]) || navigator.language || 'en',
    saved;
  try {
    saved = localStorage.getItem('nuqta-language');
  } catch (error) {
    void error;
    /* Device language remains available. */
  }
  lang =
    saved === 'ar' || saved === 'en' ? saved : lang.toLowerCase().indexOf('ar') === 0 ? 'ar' : 'en';
  function show(offline) {
    var element = document.getElementById('browser-fallback');
    if (!element) return;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    element.querySelector('p').textContent = offline
      ? lang === 'ar'
        ? 'مفيش نت دلوقتي. وصّل النت وجرب تاني.'
        : 'You’re offline. Reconnect and try again.'
      : lang === 'ar'
        ? 'حدّث المتصفح أو افتح من Chrome.'
        : 'Update your browser or open in Chrome.';
    element.hidden = false;
  }
  if (old) show(false);
  setTimeout(function () {
    if (!document.documentElement.hasAttribute('data-nuqta-ready'))
      show(navigator.onLine === false);
  }, 20000);
})();
