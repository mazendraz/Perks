import { useCallback, useEffect, useRef, useState } from 'react';
import type { Language, SavedCard } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';
import { Select } from '../controls/Select.js';
import { CustomerContact } from './CustomerOutreach.js';

export function CustomerMessages({ lang }: { lang: Language }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="panel" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{lang === 'ar' ? 'الرسايل من المحلات' : 'Messages from shops'}</summary>
      {open && <ShopMessages lang={lang} />}
    </details>
  );
}

function ShopMessages({ lang }: { lang: Language }) {
  const ar = lang === 'ar';
  const [shops, setShops] = useState<SavedCard[]>();
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void api<{ cards: SavedCard[] }>('/me/memberships')
      .then(({ cards }) => {
        if (!active) return;
        const unique = [...new Map(cards.map((card) => [card.merchant_id, card])).values()];
        setShops(unique);
        setSelected(unique[0]?.merchant_id ?? '');
      })
      .catch((failure) => active && setError(errorText(failure, lang)));
    return () => {
      active = false;
    };
  }, [lang]);

  if (error) return <p role="alert">{error}</p>;
  if (!shops) return <p role="status">{ar ? 'بنحمّل المحلات…' : 'Loading shops…'}</p>;
  if (!shops.length)
    return (
      <p className="muted">
        {ar ? 'لسه مفيش محلات مرتبطة بحسابك.' : 'Your account has no shops yet.'}
      </p>
    );

  return (
    <>
      {shops.length > 1 && (
        <label>
          {ar ? 'المحل' : 'Shop'}
          <Select value={selected} onChange={(event) => setSelected(event.target.value)}>
            {shops.map((shop) => (
              <option key={shop.merchant_id} value={shop.merchant_id}>
                {shop.merchant_name}
              </option>
            ))}
          </Select>
        </label>
      )}
      <ShopContact key={selected} merchantId={selected} lang={lang} />
    </>
  );
}

type Preference = { channel: string; granted: boolean };

function ShopContact({ merchantId, lang }: { merchantId: string; lang: Language }) {
  const ar = lang === 'ar';
  const path = '/me/merchants/' + merchantId + '/preferences';
  const [preferences, setPreferences] = useState<Preference[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const version = useRef(0);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const read = ++version.current;
    setLoading(true);
    try {
      const result = await api<{ preferences: Preference[] }>(path);
      if (version.current === read) setPreferences(result.preferences);
    } catch (failure) {
      if (version.current === read) setError(errorText(failure, lang));
    } finally {
      if (version.current === read) setLoading(false);
    }
  }, [path, lang]);
  useEffect(() => {
    void refresh();
    return () => {
      version.current++;
    };
  }, [refresh]);

  const update = async (channel: string, granted: boolean) => {
    setBusy(true);
    setError('');
    try {
      await api(path, { method: 'PATCH', body: { channel, granted } });
      setPreferences((current) =>
        current?.map((item) => (item.channel === channel ? { ...item, granted } : item)),
      );
    } catch (failure) {
      setError(errorText(failure, lang));
    } finally {
      setBusy(false);
    }
  };
  const labels: Record<string, string> = {
    email: ar ? 'البريد الإلكتروني' : 'Email',
    sms: 'SMS',
    whatsapp: ar ? 'رسايل واتساب من المحل' : 'WhatsApp messages from the shop',
    push: ar ? 'إشعارات المحفظة من المحل' : 'Wallet notifications from this shop',
  };

  return (
    <>
      <CustomerContact
        merchantId={merchantId}
        lang={lang}
        onSaved={async (reset) => {
          if (reset)
            setPreferences((current) =>
              current?.map((item) =>
                item.channel === 'whatsapp' ? { ...item, granted: false } : item,
              ),
            );
          await refresh();
        }}
      />
      {error && <p role="alert">{error}</p>}
      {preferences
        ?.filter(({ channel, granted }) => channel === 'push' || channel === 'whatsapp' || granted)
        .map(({ channel, granted }) => (
          <label className="checkbox-label" key={channel}>
            <input
              type="checkbox"
              checked={granted}
              disabled={busy || loading}
              onChange={(event) => void update(channel, event.target.checked)}
            />
            {labels[channel] || channel}
          </label>
        ))}
    </>
  );
}
