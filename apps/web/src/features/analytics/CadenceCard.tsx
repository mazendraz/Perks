import { useEffect, useState } from 'react';
import {
  businessCategories,
  businessCategoryLabels,
  type BusinessCategory,
  type Cadence,
} from '../../../../../packages/contracts/src/analytics.js';
import type { Language } from '../../../../../packages/contracts/src/index.js';
import { api, errorText } from '../../api.js';
import { copy, pick, say } from './copy.js';

/**
 * "How often do your customers come back?" — the kind of business and, if the owner wants, their
 * own numbers. Owners edit; managers read.
 */
export function CadenceCard({
  merchantId,
  lang,
  canEdit,
  startOpen,
  onSaved,
}: {
  merchantId: string;
  lang: Language;
  canEdit: boolean;
  startOpen: boolean;
  onSaved: () => void;
}) {
  const [cadence, setCadence] = useState<Cadence | null>(null),
    [editing, setEditing] = useState(startOpen),
    [category, setCategory] = useState<BusinessCategory>('other'),
    [gap, setGap] = useState(''),
    [lost, setLost] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const base = '/merchants/' + merchantId + '/cadence';
  const adopt = (c: Cadence) => {
    setCadence(c);
    setCategory(c.category);
    setGap(c.own.expectedGapDays === null ? '' : String(c.own.expectedGapDays));
    setLost(c.own.lostAfterDays === null ? '' : String(c.own.lostAfterDays));
  };
  useEffect(() => {
    api<Cadence>(base)
      .then(adopt)
      .catch((e) => setError(errorText(e, lang)));
  }, [merchantId]);
  useEffect(() => setEditing(startOpen), [startOpen]);
  if (!cadence) return error ? <p className="notice error">{error}</p> : null;
  const defaults = cadence.defaults.find((d) => d.category === category)!;
  const label = (c: BusinessCategory) => pick(businessCategoryLabels[c], lang);
  const save = async (useDefaults: boolean) => {
    setBusy(true);
    setNotice('');
    try {
      const next = await api<Cadence>(base, {
        method: 'PUT',
        key: crypto.randomUUID(),
        body: {
          category,
          expectedGapDays: useDefaults || !gap ? null : Number(gap),
          lostAfterDays: useDefaults || !lost ? null : Number(lost),
        },
      });
      adopt(next);
      setEditing(false);
      setError('');
      setNotice(pick(copy.saved, lang));
      onSaved();
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="an-card an-cadence" aria-labelledby="an-cadence-title">
      <header className="an-card-head">
        <div>
          <h2 id="an-cadence-title">{pick(copy.cadenceTitle, lang)}</h2>
          <p className="an-caption">{pick(copy.cadenceText, lang)}</p>
        </div>
        {canEdit && !editing && (
          <button className="secondary small" onClick={() => setEditing(true)}>
            {pick(copy.edit, lang)}
          </button>
        )}
      </header>
      {!editing && (
        <p className="an-note">
          <strong>{label(cadence.category)}</strong> ·{' '}
          {say(copy.cadenceNow, lang, { risk: cadence.risk, lost: cadence.lost })}
        </p>
      )}
      {editing && canEdit && (
        <form
          className="an-cadence-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
          <fieldset>
            <legend>{pick(copy.category, lang)}</legend>
            <div className="an-chips">
              {businessCategories.map((c) => (
                <label key={c} className={'an-chip' + (category === c ? ' on' : '')}>
                  <input
                    type="radio"
                    name="an-category"
                    value={c}
                    checked={category === c}
                    onChange={() => setCategory(c)}
                  />
                  {label(c)}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="an-note">
            {say(copy.cadenceDefault, lang, {
              category: label(category),
              gap: defaults.expectedGapDays,
              lost: defaults.lostAfterDays,
            })}
          </p>
          <div className="an-fields">
            <label>
              {pick(copy.gapLabel, lang)}
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={180}
                placeholder={String(defaults.expectedGapDays)}
                value={gap}
                onChange={(e) => setGap(e.target.value)}
              />
            </label>
            <label>
              {pick(copy.lostLabel, lang)}
              <input
                type="number"
                inputMode="numeric"
                min={3}
                max={365}
                placeholder={String(defaults.lostAfterDays)}
                value={lost}
                onChange={(e) => setLost(e.target.value)}
              />
            </label>
          </div>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <div className="form-actions">
            <button className="primary" disabled={busy}>
              {pick(copy.save, lang)}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void save(true)}
            >
              {pick(copy.resetDefaults, lang)}
            </button>
            {!startOpen && (
              <button type="button" className="text-button" onClick={() => setEditing(false)}>
                {pick(copy.cancel, lang)}
              </button>
            )}
          </div>
        </form>
      )}
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
