import { useEffect, useRef } from 'react';
import { portalForPath } from './portals.js';
type Refresh = () => void | Promise<void>;
const channels = new Map<string, { listeners: Set<Refresh>; stop: () => void }>();
function subscribe(url: string, refresh: Refresh) {
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
      source = new EventSource(url);
      source.addEventListener('open', () => {
        connected = true;
      });
      source.addEventListener('error', () => {
        connected = false;
      });
      source.addEventListener('sync', update);
      source.addEventListener('activity', update);
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
    connect();
    channel = {
      listeners,
      stop: () => {
        source?.close();
        window.clearTimeout(refreshTimer);
        window.clearInterval(interval);
        document.removeEventListener('visibilitychange', visibility);
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
  useEffect(() => subscribe(url, () => latest.current()), [url]);
}
