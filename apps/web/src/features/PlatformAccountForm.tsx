import { Select } from '../controls/Select.js';
import { useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api, ApiError, errorText } from '../api.js';
export interface AccountSeed {
  email: string;
  role: string;
  branch_ids: string[];
  max_qty: number;
}
export function PlatformAccountForm({
  merchantId,
  branches,
  lang,
  seed,
  onClose,
  onCreated,
}: {
  merchantId: string;
  branches: { id: string; name: string; status: string }[];
  lang: Language;
  seed?: AccountSeed;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const ar = lang === 'ar',
    [email, setEmail] = useState(seed?.email || ''),
    [password, setPassword] = useState(''),
    [role, setRole] = useState(seed?.role || 'owner'),
    [selected, setSelected] = useState(
      seed?.branch_ids || branches.filter((b) => b.status === 'active').map((b) => b.id),
    ),
    [qty, setQty] = useState(seed?.max_qty || 3),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState<{
      key: string;
      body: { email: string; password: string; role: string; branchIds: string[]; maxQty: number };
    } | null>(null);
  return (
    <div className="modal-backdrop">
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="platform-account-title"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const command = attempt || {
            key: crypto.randomUUID(),
            body: { email, password, role, branchIds: selected, maxQty: qty },
          };
          setAttempt(command);
          void api('/platform/merchants/' + merchantId + '/accounts', {
            method: 'POST',
            ...command,
          })
            .then(async () => {
              setPassword('');
              await onCreated();
              onClose();
            })
            .catch((e) => {
              setError(errorText(e, lang));
              if (
                e instanceof ApiError &&
                e.status >= 400 &&
                e.status < 500 &&
                ![401, 403, 429].includes(e.status)
              )
                setAttempt(null);
            })
            .finally(() => setBusy(false));
        }}
      >
        <h2 id="platform-account-title">{ar ? 'إنشاء حساب للمحل' : 'Create business account'}</h2>
        <p className="muted">
          {ar
            ? 'الحساب يدخل فورًا بالإيميل والباسورد. لو فيه دعوة معلّقة لنفس الإيميل في المحل، إنشاء الحساب هيستبدلها.'
            : 'The account can sign in immediately. Creating it replaces any pending invitation for this email in this business.'}
        </p>
        <label>
          {ar ? 'الإيميل' : 'Email'}
          <input
            type="email"
            dir="ltr"
            required
            value={email}
            disabled={!!attempt}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          {ar ? 'باسورد الحساب' : 'Account password'}
          <input
            type="password"
            autoComplete="new-password"
            dir="ltr"
            required
            minLength={12}
            maxLength={128}
            value={password}
            disabled={!!attempt}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          {ar ? 'الدور' : 'Role'}
          <Select
            aria-label={ar ? 'الدور' : 'Role'}
            value={role}
            disabled={!!attempt}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="owner">{ar ? 'مالك' : 'Owner'}</option>
            <option value="manager">{ar ? 'مدير' : 'Manager'}</option>
            <option value="cashier">{ar ? 'كاشير' : 'Cashier'}</option>
          </Select>
        </label>
        <fieldset disabled={!!attempt}>
          <legend>{ar ? 'الفروع المسموحة' : 'Allowed branches'}</legend>
          {branches
            .filter((b) => b.status === 'active')
            .map((b) => (
              <label key={b.id} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={selected.includes(b.id)}
                  onChange={() =>
                    setSelected((x) =>
                      x.includes(b.id) ? x.filter((v) => v !== b.id) : [...x, b.id],
                    )
                  }
                />
                {b.name}
              </label>
            ))}
        </fieldset>
        <label>
          {ar ? 'حد الأختام لكل عملية' : 'Stamp limit per transaction'}
          <input
            type="number"
            min={1}
            max={100}
            required
            disabled={!!attempt}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
          />
        </label>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="secondary" data-dialog-close onClick={onClose}>
            {ar ? 'إغلاق' : 'Close'}
          </button>
          <button className="primary" disabled={busy || !selected.length}>
            {attempt
              ? ar
                ? 'تحقق من نفس العملية'
                : 'Check same operation'
              : ar
                ? 'إنشاء الحساب'
                : 'Create account'}
          </button>
        </div>
      </form>
    </div>
  );
}
