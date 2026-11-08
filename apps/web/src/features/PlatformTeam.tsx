import { useEffect, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { Icon } from '../../../../packages/ui/src/Icon.js';
import { api, ApiError, errorText } from '../api.js';
interface AdminAccount {
  id: string;
  name: string;
  email: string;
  status: 'active' | 'disabled';
  self: boolean;
  credentialVersion: number;
  passwordSet: boolean;
  activeSessions: number;
  lastSignIn: string | null;
  lockedUntil: string | null;
}
interface TeamEvent {
  id: string;
  target_id: string;
  action: string;
  at: string;
  actor_name: string | null;
  actor_email: string | null;
  detail: { reason?: string };
}
type Action = 'create' | 'password' | 'sessions' | 'unlock' | 'disable' | 'enable';
function NewPassword({
  label,
  value,
  onChange,
  ar,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  ar: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label>
      {label}
      <span className="password-control">
        <input
          aria-label={label}
          type={visible ? 'text' : 'password'}
          dir="ltr"
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="password-reveal"
          aria-label={(ar ? (visible ? 'إخفاء ' : 'إظهار ') : visible ? 'Hide ' : 'Show ') + label}
          onClick={() => setVisible(!visible)}
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} />
        </button>
      </span>
    </label>
  );
}
export function PlatformTeam({ lang }: { lang: Language }) {
  const ar = lang === 'ar';
  const [accounts, setAccounts] = useState<AdminAccount[]>([]),
    [events, setEvents] = useState<TeamEvent[]>([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{ action: Action; account?: AdminAccount } | null>(null),
    [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [reason, setReason] = useState(''),
    [ack, setAck] = useState(false),
    [attempt, setAttempt] = useState<{ key: string; body: Record<string, unknown> } | null>(null);
  const load = async () => {
    const r = await api<{ accounts: AdminAccount[]; events: TeamEvent[] }>('/platform/admins');
    setAccounts(r.accounts);
    setEvents(r.events);
  };
  useEffect(() => {
    void load().catch((e) => setError(errorText(e, lang)));
    const timer = setInterval(() => {
      if (!document.hidden) void load().catch((e) => setError(errorText(e, lang)));
    }, 10000);
    return () => clearInterval(timer);
  }, []);
  const open = (action: Action, account?: AdminAccount) => {
    setEditor({ action, account });
    setName('');
    setEmail('');
    setPassword('');
    setConfirm('');
    setReason('');
    setAck(false);
    setAttempt(null);
    setError('');
    setNotice('');
  };
  const close = () => {
    setEditor(null);
    setPassword('');
    setConfirm('');
    setAttempt(null);
  };
  const labels: Record<Action, string> = {
    create: ar ? 'إضافة سوبر أدمن' : 'Add super admin',
    password: ar ? 'تغيير الباسورد' : 'Change password',
    sessions: ar ? 'خروج من الأجهزة' : 'Sign out devices',
    unlock: ar ? 'فتح تسجيل الدخول' : 'Unlock sign-in',
    disable: ar ? 'إيقاف الحساب' : 'Disable account',
    enable: ar ? 'تفعيل الحساب' : 'Enable account',
  };
  const complete = async () => {
    close();
    setNotice(
      ar
        ? 'الإجراء اتحفظ، والفريق يقدر يشوف التحديث.'
        : 'Saved. The updated account is visible to the team.',
    );
    await load();
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{ar ? 'إدارة نقطة' : 'NUQTA ADMINISTRATION'}</span>
          <h1>{ar ? 'فريق إدارة نقطة' : 'Platform team'}</h1>
          <p className="muted">
            {ar
              ? 'كل مسؤول له حسابه، وكلكم بتتابعوا نفس المحلات والدعم. كل إجراء بيتسجل باسم صاحبه.'
              : 'Each administrator has their own account. Your team shares businesses and support, with an activity record for every action.'}
          </p>
        </div>
        <div className="form-actions">
          <button
            className="secondary"
            onClick={() => void load().catch((e) => setError(errorText(e, lang)))}
          >
            {ar ? 'تحديث' : 'Refresh'}
          </button>
          <button className="primary" onClick={() => open('create')}>
            {labels.create}
          </button>
        </div>
      </div>
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      {error && !editor && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <section className="panel">
        <div className="section-heading">
          <h2>{ar ? 'حسابات السوبر أدمن' : 'Super admin accounts'}</h2>
          <span className="badge">
            {accounts.filter((a) => a.status === 'active').length} {ar ? 'نشط' : 'active'}
          </span>
        </div>
        <div className="table-wrap">
          <table className="platform-team-table">
            <thead>
              <tr>
                {(ar
                  ? ['المسؤول', 'الحالة', 'الجلسات', 'آخر دخول', 'الإجراءات']
                  : ['Administrator', 'Status', 'Sessions', 'Last sign-in', 'Actions']
                ).map((t) => (
                  <th key={t}>{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.name}</strong>
                    <small>
                      <bdi>{a.email}</bdi>
                    </small>
                    {a.self && (
                      <span className="badge">{ar ? 'حسابك الحالي' : 'Your account'}</span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      role="switch"
                      className="business-status-switch"
                      aria-label={(ar ? 'تفعيل المسؤول: ' : 'Administrator active: ') + a.email}
                      aria-checked={a.status === 'active'}
                      disabled={a.self || busy}
                      onClick={() => open(a.status === 'active' ? 'disable' : 'enable', a)}
                    >
                      <span className="ios-switch-track" aria-hidden="true">
                        <span />
                      </span>
                      <span>
                        {a.status === 'active'
                          ? ar
                            ? 'نشط'
                            : 'Active'
                          : ar
                            ? 'متوقف'
                            : 'Disabled'}
                      </span>
                    </button>
                    {a.lockedUntil && (
                      <small>
                        {ar ? 'تسجيل الدخول مقفول مؤقتًا' : 'Sign-in temporarily locked'}
                      </small>
                    )}
                  </td>
                  <td>{a.activeSessions}</td>
                  <td>
                    {a.lastSignIn
                      ? new Date(a.lastSignIn).toLocaleString(lang)
                      : ar
                        ? 'لسه ما دخلش'
                        : 'Not signed in yet'}
                  </td>
                  <td>
                    {a.self ? (
                      <small className="muted">
                        {ar ? 'إعدادات حسابك من «حسابي»' : 'Manage your own password in My account'}
                      </small>
                    ) : (
                      <div className="form-actions">
                        <button className="secondary small" onClick={() => open('password', a)}>
                          {labels.password}
                        </button>
                        <button className="text-button" onClick={() => open('sessions', a)}>
                          {labels.sessions}
                        </button>
                        {a.lockedUntil && (
                          <button className="text-button" onClick={() => open('unlock', a)}>
                            {labels.unlock}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h2>{ar ? 'نشاط فريق الإدارة' : 'Administration team activity'}</h2>
        {events.length ? (
          events.map((e) => (
            <div className="list-row" key={e.id}>
              <div>
                <strong>
                  {e.actor_name ||
                    e.actor_email ||
                    (ar ? 'مسؤول المنصة' : 'Platform administrator')}
                </strong>
                <small>
                  <bdi>{e.actor_email}</bdi>
                </small>
                <small>
                  {labels[e.action.replace('platform.admin.', '') as Action] || e.action} ·{' '}
                  {accounts.find((a) => a.id === e.target_id)?.name} · {e.detail.reason}
                </small>
              </div>
              <small>{new Date(e.at).toLocaleString(lang)}</small>
            </div>
          ))
        ) : (
          <p className="muted">
            {ar
              ? 'أي إضافة أو تغيير لحساب مسؤول هيظهر هنا باسم اللي عمله.'
              : 'Administrator account changes will appear here with the person who made them.'}
          </p>
        )}
      </section>
      {editor && (
        <div className="modal-backdrop">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="platform-team-action"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                !attempt &&
                (editor.action === 'create' || editor.action === 'password') &&
                password !== confirm
              ) {
                setError(ar ? 'الباسوردين مش متطابقين.' : 'Passwords do not match.');
                return;
              }
              setBusy(true);
              setError('');
              const command = attempt || {
                key: crypto.randomUUID(),
                body:
                  editor.action === 'create'
                    ? { name, email, password, reason, acknowledgeFullAccess: ack }
                    : {
                        action: editor.action,
                        credentialVersion: editor.account!.credentialVersion,
                        reason,
                        acknowledgeFullAccess: ack,
                        ...(editor.action === 'password' ? { password } : {}),
                      },
              };
              setAttempt(command);
              const scope =
                editor.action === 'create'
                  ? 'platform.admin.create'
                  : 'platform.admin.security:' + editor.account!.id;
              try {
                await api(
                  editor.action === 'create'
                    ? '/platform/admins'
                    : '/platform/admins/' + editor.account!.id + '/security',
                  { method: 'POST', body: command.body, key: command.key },
                );
                await complete();
              } catch (ex) {
                if (ex instanceof ApiError && ex.code === 'NETWORK_UNCERTAIN') {
                  try {
                    const recovered = await api<{ status: string }>(
                      '/operations/by-key?scope=' +
                        encodeURIComponent(scope) +
                        '&key=' +
                        command.key,
                    );
                    if (recovered.status === 'committed') {
                      await complete();
                      return;
                    }
                  } catch {
                    /* Keep the exact command for a retry. */
                  }
                } else setAttempt(null);
                setError(errorText(ex, lang));
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2 id="platform-team-action">{labels[editor.action]}</h2>
            {editor.account && (
              <p>
                <strong>{editor.account.name}</strong> · <bdi>{editor.account.email}</bdi>
              </p>
            )}
            {editor.action === 'create' && (
              <>
                <label>
                  {ar ? 'اسم المسؤول' : 'Administrator name'}
                  <input
                    required
                    maxLength={100}
                    value={name}
                    disabled={busy || !!attempt}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label>
                  {ar ? 'الإيميل' : 'Email'}
                  <input
                    required
                    type="email"
                    dir="ltr"
                    autoComplete="off"
                    value={email}
                    disabled={busy || !!attempt}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
              </>
            )}
            {(editor.action === 'create' || editor.action === 'password') && (
              <fieldset disabled={busy || !!attempt} className="admin-password-fields">
                <NewPassword
                  label={ar ? 'الباسورد الجديد' : 'New password'}
                  value={password}
                  onChange={setPassword}
                  ar={ar}
                />
                <NewPassword
                  label={ar ? 'تأكيد الباسورد' : 'Confirm password'}
                  value={confirm}
                  onChange={setConfirm}
                  ar={ar}
                />
                <small className="muted">
                  {ar
                    ? '١٢ حرف على الأقل. الباسورد مش بيتعرض تاني بعد الحفظ.'
                    : 'At least 12 characters. The password is not shown again after saving.'}
                </small>
              </fieldset>
            )}
            <label>
              {ar ? 'سبب الإجراء' : 'Reason'}
              <textarea
                required
                minLength={4}
                maxLength={500}
                value={reason}
                disabled={busy || !!attempt}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                required
                checked={ack}
                disabled={busy || !!attempt}
                onChange={(e) => setAck(e.target.checked)}
              />
              {ar
                ? 'فاهم إن ده حساب إدارة كامل لكل المحلات، وتغيير الباسورد أو إيقاف الحساب بيلغي جلساته.'
                : 'I understand this account has full platform access and changing its password or disabling it signs out its sessions.'}
            </label>
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                data-dialog-close
                disabled={busy}
                onClick={close}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button className="primary" disabled={busy}>
                {attempt ? (ar ? 'إعادة نفس المحاولة' : 'Retry same action') : ar ? 'حفظ' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
