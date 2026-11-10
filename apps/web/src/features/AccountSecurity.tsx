import { Select } from '../controls/Select.js';
import { useEffect, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api, ApiError, errorText } from '../api.js';
import { Icon } from '../../../../packages/ui/src/Icon.js';
import { staffRoleLabel, staffStatusLabel } from '../business-labels.js';
export interface SecurityAccount {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'manager' | 'cashier';
  status: 'active' | 'disabled';
  revision: number;
  max_qty: number;
  branch_ids: string[];
  branches: string[];
  self: boolean;
  canManageCredentials: boolean;
  credentialVersion: number | null;
  passwordSet: boolean;
  passwordChangedAt: string | null;
  activeSessions: number | null;
  lockedUntil: string | null;
  user_status: string;
}
export function AccountSecurity({
  merchantId,
  lang,
  branches,
  refreshKey = '',
  onChanged,
}: {
  merchantId: string;
  lang: Language;
  branches: { id: string; name: string }[];
  refreshKey?: string;
  onChanged?: () => Promise<void>;
}) {
  const ar = lang === 'ar',
    [rows, setRows] = useState<SecurityAccount[]>([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState<{
      account: SecurityAccount;
      type: 'password' | 'sessions' | 'unlock' | 'access';
    } | null>(null),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [visible, setVisible] = useState(false),
    [reason, setReason] = useState(''),
    [checked, setChecked] = useState(false),
    [edit, setEdit] = useState<SecurityAccount | null>(null),
    [attempt, setAttempt] = useState<{ key: string; body: Record<string, unknown> } | null>(null);
  const load = async () => {
    try {
      setRows(
        (
          await api<{ accounts: SecurityAccount[] }>(
            '/merchants/' + merchantId + '/account-security',
          )
        ).accounts,
      );
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    void load();
  }, [merchantId, refreshKey]);
  const open = (account: SecurityAccount, type: NonNullable<typeof action>['type']) => {
    setAction({ account, type });
    setEdit({ ...account, branch_ids: [...account.branch_ids] });
    setPassword('');
    setConfirm('');
    setVisible(false);
    setReason('');
    setChecked(false);
    setAttempt(null);
    setError('');
  };
  return (
    <div className="account-security">
      <div className="section-heading">
        <h3>{ar ? 'الحسابات والدخول' : 'Accounts and sign-in'}</h3>
        <button className="text-button" onClick={() => void load()}>
          {ar ? 'تحديث الحسابات' : 'Refresh accounts'}
        </button>
      </div>
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      {error && !action && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="table-wrap mobile-records">
        <table>
          <thead>
            <tr>
              {(ar
                ? ['الحساب', 'الدور والفروع', 'الحالة', 'الدخول', 'التحكم']
                : ['Account', 'Role and branches', 'Status', 'Sign-in', 'Controls']
              ).map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td data-label={ar ? 'الحساب' : 'Account'}>
                  <strong>{a.name}</strong>
                  <small>
                    <bdi>{a.email}</bdi>
                  </small>
                </td>
                <td data-label={ar ? 'الدور والفروع' : 'Role and branches'}>
                  {staffRoleLabel(a.role, lang)}
                  <small>{a.branches.join(' · ')}</small>
                </td>
                <td data-label={ar ? 'الحالة' : 'Status'}>
                  <span className="badge">{staffStatusLabel(a.status, lang)}</span>
                  {a.lockedUntil && (
                    <small>
                      {ar
                        ? 'فيه محاولات دخول متوقفة مؤقتًا'
                        : 'Some sign-in attempts are temporarily restricted'}
                    </small>
                  )}
                </td>
                <td data-label={ar ? 'الدخول' : 'Sign-in'}>
                  <small>
                    {a.passwordSet
                      ? ar
                        ? 'باسورد جاهز'
                        : 'Password set'
                      : ar
                        ? 'باسورد غير مجهز'
                        : 'Password not set'}
                  </small>
                  {a.activeSessions !== null && (
                    <small>
                      {ar ? 'جلسات مفتوحة: ' : 'Active sessions: '}
                      {a.activeSessions}
                    </small>
                  )}
                  {a.passwordChangedAt && (
                    <small>
                      {ar ? 'آخر تغيير: ' : 'Changed: '}
                      {new Date(a.passwordChangedAt).toLocaleString(lang)}
                    </small>
                  )}
                </td>
                <td data-label={ar ? 'التحكم' : 'Controls'}>
                  <div className="account-actions">
                    <button className="text-button" onClick={() => open(a, 'access')}>
                      {ar ? 'تعديل الحساب' : 'Edit account'}
                    </button>
                    {a.canManageCredentials ? (
                      <>
                        <button className="text-button" onClick={() => open(a, 'password')}>
                          {ar ? 'باسورد جديد' : 'Set password'}
                        </button>
                        <button className="text-button" onClick={() => open(a, 'sessions')}>
                          {ar ? 'خروج من الأجهزة' : 'Sign out devices'}
                        </button>
                        {a.lockedUntil && (
                          <button className="text-button" onClick={() => open(a, 'unlock')}>
                            {ar ? 'فتح الدخول' : 'Unlock sign-in'}
                          </button>
                        )}
                      </>
                    ) : (
                      <small className="muted">
                        {a.self
                          ? ar
                            ? 'باسوردك من «حسابي»'
                            : 'Your password is in My account'
                          : ar
                            ? 'استعادة الحساب أو إدارة المنصة'
                            : 'Use account recovery or platform administration'}
                      </small>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p className="muted">
          {ar
            ? 'لسه مفيش حسابات مفعّلة. جهّز حساب المالك أولًا.'
            : 'No active accounts yet. Set up the owner account first.'}
        </p>
      )}
      {action && edit && (
        <div className="modal-backdrop">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-action-title"
            onSubmit={async (e) => {
              e.preventDefault();
              if (action.type === 'password' && password !== confirm) {
                setError(ar ? 'الباسوردين مش متطابقين.' : 'Passwords do not match.');
                return;
              }
              setBusy(true);
              setError('');
              try {
                if (action.type === 'access') {
                  await api('/merchants/' + merchantId + '/staff/' + edit.id, {
                    method: 'PATCH',
                    revision: edit.revision,
                    body: {
                      name: edit.name,
                      status: edit.status,
                      role: edit.role,
                      branchIds: edit.branch_ids,
                      maxQty: edit.max_qty,
                      reason,
                    },
                  });
                } else {
                  const command = attempt || {
                    key: crypto.randomUUID(),
                    body: {
                      action: action.type,
                      credentialVersion: action.account.credentialVersion,
                      acknowledgeAccountWide: true,
                      reason,
                      ...(action.type === 'password' ? { password } : {}),
                    },
                  };
                  setAttempt(command);
                  await api('/merchants/' + merchantId + '/staff/' + edit.id + '/security', {
                    method: 'POST',
                    ...command,
                  });
                }
                setPassword('');
                setConfirm('');
                setAttempt(null);
                setAction(null);
                setNotice(
                  action.type === 'password'
                    ? ar
                      ? 'الباسورد اتغيّر وكل الجلسات القديمة اتقفلت.'
                      : 'Password changed. Previous sessions were signed out.'
                    : action.type === 'sessions'
                      ? ar
                        ? 'الجلسات اتقفلت. الحساب يقدر يدخل تاني بنفس الباسورد.'
                        : 'Sessions signed out. The existing password still works.'
                      : action.type === 'unlock'
                        ? ar
                          ? 'الدخول اتفتح.'
                          : 'Sign-in unlocked.'
                        : ar
                          ? 'بيانات وصلاحيات الحساب اتحفظت.'
                          : 'Account settings saved.',
                );
                await load();
                await onChanged?.();
              } catch (e) {
                setError(errorText(e, lang));
                if (
                  e instanceof ApiError &&
                  e.status >= 400 &&
                  e.status < 500 &&
                  ![401, 403, 429].includes(e.status)
                )
                  setAttempt(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2 id="account-action-title">
              {action.type === 'access'
                ? ar
                  ? 'تعديل الحساب'
                  : 'Edit account'
                : action.type === 'password'
                  ? ar
                    ? 'تحديد باسورد جديد'
                    : 'Set a new password'
                  : action.type === 'sessions'
                    ? ar
                      ? 'خروج من كل الأجهزة'
                      : 'Sign out all devices'
                    : ar
                      ? 'فتح تسجيل الدخول'
                      : 'Unlock sign-in'}
            </h2>
            <p>
              <bdi>{edit.email}</bdi>
            </p>
            {action.type === 'access' ? (
              <>
                <label>
                  {ar ? 'اسم الموظف' : 'Staff name'}
                  <input
                    required
                    maxLength={100}
                    value={edit.name}
                    onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  />
                </label>
                <div className="form-grid">
                  <label>
                    {ar ? 'الدور' : 'Role'}
                    <Select
                      aria-label={ar ? 'الدور' : 'Role'}
                      value={edit.role}
                      onChange={(e) =>
                        setEdit({ ...edit, role: e.target.value as SecurityAccount['role'] })
                      }
                    >
                      <option value="owner">{ar ? 'مالك' : 'Owner'}</option>
                      <option value="manager">{ar ? 'مدير' : 'Manager'}</option>
                      <option value="cashier">{ar ? 'كاشير' : 'Cashier'}</option>
                    </Select>
                  </label>
                  <label>
                    {ar ? 'الحالة' : 'Status'}
                    <Select
                      aria-label={ar ? 'الحالة' : 'Status'}
                      value={edit.status}
                      onChange={(e) =>
                        setEdit({ ...edit, status: e.target.value as SecurityAccount['status'] })
                      }
                    >
                      <option value="active">{ar ? 'نشط' : 'Active'}</option>
                      <option value="disabled">{ar ? 'موقوف' : 'Disabled'}</option>
                    </Select>
                  </label>
                </div>
                <fieldset>
                  <legend>{ar ? 'الفروع المسموحة' : 'Allowed branches'}</legend>
                  {branches.map((b) => (
                    <label className="checkbox-label" key={b.id}>
                      <input
                        type="checkbox"
                        checked={edit.branch_ids.includes(b.id)}
                        onChange={() =>
                          setEdit({
                            ...edit,
                            branch_ids: edit.branch_ids.includes(b.id)
                              ? edit.branch_ids.filter((id) => id !== b.id)
                              : [...edit.branch_ids, b.id],
                          })
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
                    value={edit.max_qty}
                    onChange={(e) => setEdit({ ...edit, max_qty: Number(e.target.value) })}
                  />
                </label>
              </>
            ) : (
              <>
                <p className="muted">
                  {ar
                    ? 'التحكم هنا في حساب الدخول نفسه، وأي تغيير باسورد أو خروج هيقفل جلساته في كل المساحات المرتبطة بيه. الحسابات الشخصية والمشتركة يديرها صاحب الحساب أو المنصة.'
                    : 'These controls affect the sign-in account across its workspaces. Personal or shared accounts are managed by the account holder or platform.'}
                </p>
                {action.type === 'password' && (
                  <>
                    <label>
                      {ar ? 'الباسورد الجديد' : 'New password'}
                      <div className="password-control">
                        <input
                          type={visible ? 'text' : 'password'}
                          aria-label={ar ? 'الباسورد الجديد' : 'New password'}
                          autoComplete="new-password"
                          dir="ltr"
                          minLength={10}
                          maxLength={128}
                          required
                          disabled={!!attempt}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                        <button
                          type="button"
                          className="password-reveal"
                          aria-label={
                            visible
                              ? ar
                                ? 'إخفاء الباسورد'
                                : 'Hide password'
                              : ar
                                ? 'إظهار الباسورد'
                                : 'Show password'
                          }
                          onClick={() => setVisible((v) => !v)}
                        >
                          <Icon name="eye" size={19} />
                        </button>
                      </div>
                    </label>
                    <label>
                      {ar ? 'تأكيد الباسورد' : 'Confirm password'}
                      <input
                        type={visible ? 'text' : 'password'}
                        aria-label={ar ? 'تأكيد الباسورد' : 'Confirm password'}
                        autoComplete="new-password"
                        dir="ltr"
                        required
                        disabled={!!attempt}
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="text-button"
                      disabled={!!attempt}
                      onClick={() => {
                        const chars =
                            'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-',
                          bytes = crypto.getRandomValues(new Uint8Array(20)),
                          generated = 'Perks!' + Array.from(bytes, (b) => chars[b & 63]).join('');
                        setPassword(generated);
                        setConfirm(generated);
                        setVisible(true);
                      }}
                    >
                      {ar ? 'توليد باسورد قوي' : 'Generate strong password'}
                    </button>
                  </>
                )}
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    required
                    disabled={!!attempt}
                    checked={checked}
                    onChange={(e) => setChecked(e.target.checked)}
                  />
                  {ar
                    ? 'فاهم إن التغيير على حساب الدخول نفسه.'
                    : 'I understand this affects the sign-in account.'}
                </label>
              </>
            )}
            <label>
              {ar ? 'سبب التغيير' : 'Reason for change'}
              <textarea
                required
                minLength={4}
                maxLength={500}
                disabled={!!attempt}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                data-dialog-close
                onClick={() => {
                  setAction(null);
                  setPassword('');
                  setConfirm('');
                  setAttempt(null);
                }}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                className="primary"
                disabled={busy || (action.type === 'access' && !edit.branch_ids.length)}
              >
                {attempt
                  ? ar
                    ? 'تحقق من نفس العملية'
                    : 'Check same operation'
                  : ar
                    ? 'حفظ التغيير'
                    : 'Save change'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
