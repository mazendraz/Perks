import { useEffect, useRef } from 'react';
import { portalForPath } from './portals.js';
type Refresh = () => void | Promise<void>;
const channels = new Map<string, { listeners: Set<Refresh>; stop: () => void }>();
export function subscribeLiveRefresh(url: string, refresh: Refresh) {
  let channel = channels.get(url);
  if (!channel) {
    const listeners = new Set<Refresh>();
    let source: EventSource | undefined,
      connected = false,
      refreshTimer: number | undefined;
    const update = () => {
      if (document.hidden) return;
      if (refreshTimer !== undefined) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        for (const receive of listeners)
          void Promise.resolve()
            .then(receive)
            .catch(() => {});
      }, 75);
    };
    const connect = () => {
      if (document.hidden || source || typeof EventSource !== 'function') return;
      const stream = new EventSource(url);
      source = stream;
      stream.addEventListener('open', () => {
        if (source === stream) connected = true;
      });
      stream.addEventListener('error', () => {
        if (source !== stream) return;
        connected = false;
        // Avoid the browser reconnecting an obsolete authenticated stream.
        // The bounded poll below retries using the latest scoped cookies.
        stream.close();
        source = undefined;
        update();
      });
      stream.addEventListener('sync', update);
      stream.addEventListener('activity', update);
    };
    const restored = () => {
      // REST recovery has already validated the device and committed new
      // cookies/CSRF. Retire the stream bound to the old session immediately,
      // before the next purchase notification discovers its expired actor.
      source?.close();
      source = undefined;
      connected = false;
      connect();
      update();
    };
    const visibility = () => {
      if (document.hidden) {
        source?.close();
        window.clearTimeout(refreshTimer);
        refreshTimer = undefined;
        source = undefined;
        connected = false;
      } else {
        connect();
        update();
      }
    };
    const interval = window.setInterval(() => {
      if (!connected && !document.hidden) {
        connect();
        update();
      }
    }, 3000);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('nuqta:customer-session-restored', restored);
    connect();
    channel = {
      listeners,
      stop: () => {
        source?.close();
        window.clearTimeout(refreshTimer);
        window.clearInterval(interval);
        document.removeEventListener('visibilitychange', visibility);
        window.removeEventListener('nuqta:customer-session-restored', restored);
      },
    };
    channels.set(url, channel);
  }
  channel.listeners.add(refresh);
  return () => {
    channel.listeners.delete(refresh);
    if (!channel.listeners.size) {
      channel.stop();
      channels.delete(url);
    }
  };
}
export function useLiveRefresh(path: string, refresh: Refresh) {
  const latest = useRef(refresh);
  latest.current = refresh;
  const portal = portalForPath(location.pathname);
  const url = '/api/v1' + path + (portal ? '?__portal=' + portal : '');
  useEffect(() => subscribeLiveRefresh(url, () => latest.current()), [url]);
}
