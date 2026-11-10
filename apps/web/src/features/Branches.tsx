import { Select } from '../controls/Select.js';
import { statusLabel } from '../business-labels.js';
import { useEffect, useState, type FormEvent } from 'react';
import type { Grant, Language } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';
interface Branch {
  id: string;
  name: string;
  address: string;
  status: string;
  revision: number;
}
export function Branches({ grant, lang }: { grant: Grant; lang: Language }) {
  const ar = lang === 'ar',
    base = '/merchants/' + grant.merchant_id,
    [rows, setRows] = useState<Branch[]>([]),
    [editing, setEditing] = useState<Branch | null>(null),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    void api<{ branches: Branch[] }>(base + '/branches')
      .then((r) => setRows(r.branches))
      .catch((e) => setError(errorText(e, lang)));
  }, [grant.id]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      await api(base + '/branches' + (editing.id ? '/' + editing.id : ''), {
        method: editing.id ? 'PATCH' : 'POST',
        key: crypto.randomUUID(),
        revision: editing.revision,
        body: editing.id
          ? { name: editing.name, address: editing.address, status: editing.status, reason }
          : { name: editing.name, address: editing.address },
      });
      location.reload();
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>{ar ? 'الفروع' : 'Branches'}</h2>
        {grant.role === 'owner' && (
          <button
            className="primary"
            onClick={() => {
              setEditing({ id: '', name: '', address: '', status: 'active', revision: 1 });
              setReason('');
            }}
          >
            {ar ? 'إضافة فرع' : 'Add branch'}
          </button>
        )}
      </div>
      <p className="muted">
        {ar
          ? 'الفرع الجديد محتاج يتضاف لنسخة برنامج جديدة. حقوق العضويات والمكافآت القديمة بتفضل مرتبطة بنسختها.'
          : 'Add a new branch to a new program version. Existing memberships and earned rewards retain their original version and branch rights.'}
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {rows.map((b) => (
        <div className="list-row" key={b.id}>
          <div>
            <strong>{b.name}</strong>
            <small>{b.address}</small>
          </div>
          <span className="badge">{statusLabel(b.status, lang)}</span>
          {grant.role === 'owner' && (
            <button
              className="text-button"
              onClick={() => {
                setEditing(b);
                setReason('');
              }}
            >
              {ar ? 'تعديل' : 'Edit'}
            </button>
          )}
        </div>
      ))}
      {editing && (
        <div className="modal-backdrop">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="branch-title"
            onSubmit={(e) => void submit(e)}
          >
            <h2 id="branch-title">{ar ? 'بيانات الفرع' : 'Branch details'}</h2>
            <label>
              {ar ? 'اسم الفرع' : 'Branch name'}
              <input
                autoFocus
                required
                minLength={2}
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </label>
            <label>
              {ar ? 'العنوان' : 'Address'}
              <input
                maxLength={500}
                value={editing.address}
                onChange={(e) => setEditing({ ...editing, address: e.target.value })}
              />
            </label>
            {editing.id && (
              <>
                <label>
                  {ar ? 'الحالة' : 'Status'}
                  <Select
                    value={editing.status}
                    onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                  >
                    <option value="active">{ar ? 'نشط' : 'Active'}</option>
                    <option value="disabled">{ar ? 'موقوف' : 'Disabled'}</option>
                  </Select>
                </label>
                <label>
                  {ar ? 'سبب التعديل' : 'Change reason'}
                  <textarea
                    required
                    minLength={4}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              </>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                data-dialog-close
                onClick={() => setEditing(null)}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button className="primary" disabled={busy}>
                {ar ? 'حفظ' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
