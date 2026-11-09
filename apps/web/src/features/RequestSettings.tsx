import { useEffect, useState, type FormEvent } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';
export function RequestSettings({
  merchantId,
  lang,
  onSaved,
}: {
  merchantId: string;
  lang: Language;
  onSaved: () => void;
}) {
  const [limit, setLimit] = useState(10),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const ar = lang === 'ar',
    path = '/merchants/' + merchantId + '/stamp-request-settings';
  const load = async () => {
    try {
      const data = await api<{ dailyLimit: number; revision: number }>(path);
      setLimit(data.dailyLimit);
      setRevision(data.revision);
    } catch (error) {
      setError(errorText(error, lang));
    }
  };
  useEffect(() => {
    void load();
  }, [merchantId]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const data = await api<{ dailyLimit: number; revision: number }>(path, {
        method: 'PATCH',
        revision,
        body: { dailyLimit: limit },
      });
      setRevision(data.revision);
      setSaved(true);
      onSaved();
    } catch (error) {
      setError(errorText(error, lang));
      await load();
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="panel" onSubmit={(event) => void save(event)}>
      <h3>{ar ? 'طلبات الأختام' : 'Stamp requests'}</h3>
      <p className="muted">
        {ar
          ? 'الطلب صالح ١٠ دقايق. الختم محتاج سكان كود العميل وموافقة الكاشير.'
          : 'Requests last 10 minutes. Stamps require a customer code scan and cashier approval.'}
      </p>
      <label>
        {ar ? 'أقصى طلبات لكل عميل في اليوم' : 'Maximum requests per customer per day'}
        <input
          type="number"
          min={1}
          max={100}
          required
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
        />
      </label>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="notice success" role="status">
          {ar ? 'الحد اليومي اتحفظ.' : 'Daily limit saved.'}
        </p>
      )}
      <button className="secondary" disabled={busy || !revision}>
        {ar ? 'احفظ الحد' : 'Save limit'}
      </button>
    </form>
  );
}
