import { useEffect, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import {
  personalizeMessage,
  type ReminderSettings,
  type WhatsAppPurpose,
} from '../../../../packages/contracts/src/customer-reminders.js';
import { api, errorText } from '../api.js';
import { Select } from '../controls/Select.js';

export interface ReminderConfig {
  settings: ReminderSettings;
  revision: number;
  canManage: boolean;
  merchantName: string;
  timezone: string;
  providers: { apple: boolean; google: boolean };
  stats: {
    queued: number;
    accepted: number;
    failed: number;
    uncertain: number;
    customers: number;
    returned: number;
  } | null;
  recent: {
    id: string;
    alias: string;
    channel: string;
    status: string;
    created_at: string;
    returned_at: string | null;
  }[];
}
export const purposeLabels = (ar: boolean): Record<WhatsAppPurpose, string> => ({
  followup: ar ? 'متابعة الزيارة' : 'Visit follow-up',
  welcome: ar ? 'ترحيب بأول زيارة' : 'First visit welcome',
  inactive: ar ? 'وحشتنا' : 'We miss you',
  reward: ar ? 'مكافأة جاهزة' : 'Reward ready',
});
export function CustomerReminders({
  merchantId,
  lang,
  config,
  onSaved,
  onRefresh,
}: {
  merchantId: string;
  lang: Language;
  config: ReminderConfig;
  onSaved: (config: ReminderConfig) => void;
  onRefresh: () => void;
}) {
  const ar = lang === 'ar',
    [settings, setSettings] = useState(config.settings),
    [editingLanguage, setEditingLanguage] = useState<'ar' | 'en'>(lang),
    [purpose, setPurpose] = useState<WhatsAppPurpose>('inactive'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setSettings(config.settings);
  }, [config.revision]);
  if (!config.canManage) return null;
  const labels = purposeLabels(ar),
    stats = config.stats;
  const statuses: Record<string, string> = {
    queued: ar ? 'في الانتظار' : 'Queued',
    processing: ar ? 'جاري الإرسال' : 'Sending',
    accepted: ar ? 'قبلتها خدمة الإشعارات' : 'Accepted by notification service',
    failed: ar ? 'تعذر الإرسال' : 'Failed',
    skipped: ar ? 'التذكير اتلغى' : 'Skipped',
    uncertain: ar ? 'الإرسال محتاج تأكيد' : 'Delivery unconfirmed',
  };
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>{ar ? 'تذكير العملاء الغايبين' : 'Bring customers back'}</h2>
        <button className="secondary small" onClick={onRefresh}>
          {ar ? 'تحديث السجل' : 'Refresh activity'}
        </button>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          setNotice('');
          try {
            const saved = await api<{ settings: ReminderSettings; revision: number }>(
              '/merchants/' + merchantId + '/customer-reminders',
              {
                method: 'PATCH',
                body: settings,
                revision: config.revision,
                key: crypto.randomUUID(),
              },
            );
            onSaved({ ...config, ...saved });
            setNotice(ar ? 'الإعدادات اتحفظت.' : 'Settings saved.');
          } catch (cause) {
            setError(errorText(cause, lang));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
          />
          {ar ? 'تذكير تلقائي على كارت Wallet' : 'Automatic Wallet card reminders'}
        </label>
        <p className="muted">
          {ar
            ? 'التذكير بيتحسب من آخر شراء أو ختم مؤكد، وبيتبعت مرة لكل فترة غياب للعميل الموافق على التذكيرات.'
            : 'Reminders use the latest confirmed purchase or stamp and send once per absence to customers who opted in.'}
        </p>
        {!config.providers.apple && !config.providers.google && (
          <p role="status">
            {ar
              ? 'إرسال التذكيرات هيبدأ لما خدمة Apple Wallet أو Google Wallet تتجهز على السيرفر.'
              : 'Reminders start sending when Apple Wallet or Google Wallet is configured on the server.'}
          </p>
        )}
        <div className="filter-row">
          <label>
            {ar ? 'بعد كام يوم غياب؟' : 'Days since last visit'}
            <input
              type="number"
              min={1}
              max={365}
              required
              value={settings.inactivityDays}
              onChange={(e) => setSettings({ ...settings, inactivityDays: e.target.valueAsNumber })}
            />
          </label>
          <label>
            {ar ? 'أقل مدة بين تذكيرين بالأيام' : 'Minimum days between reminders'}
            <input
              type="number"
              min={7}
              max={365}
              required
              value={settings.cooldownDays}
              onChange={(e) => setSettings({ ...settings, cooldownDays: e.target.valueAsNumber })}
            />
          </label>
          <label>
            {ar ? 'ساعة بدء الإرسال' : 'Start sending at'}
            <Select
              value={String(settings.sendHour)}
              onChange={(e) => setSettings({ ...settings, sendHour: Number(e.target.value) })}
            >
              {Array.from({ length: 13 }, (_, i) => i + 8).map((hour) => (
                <option key={hour} value={hour}>
                  {String(hour).padStart(2, '0')}:00
                </option>
              ))}
            </Select>
            <small>
              <bdi>{config.timezone}</bdi>
            </small>
          </label>
        </div>
        <label>
          {ar ? 'لغة القالب' : 'Template language'}
          <Select
            value={editingLanguage}
            onChange={(e) => setEditingLanguage(e.target.value as 'ar' | 'en')}
          >
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </Select>
        </label>
        <label>
          {ar ? 'رسالة التذكير على Wallet' : 'Wallet reminder message'}
          <textarea
            dir={editingLanguage === 'ar' ? 'rtl' : 'ltr'}
            required
            maxLength={800}
            rows={3}
            value={settings.wallet[editingLanguage]}
            onChange={(e) =>
              setSettings({
                ...settings,
                wallet: { ...settings.wallet, [editingLanguage]: e.target.value },
              })
            }
          />
        </label>
        <p className="muted">
          {ar
            ? 'استخدم {name} لاسم العميل و{business} لاسم المحل. الرسالة بتتبعت بلغة العميل.'
            : 'Use {name} for the customer and {business} for the business. Reminders use the customer’s language.'}
        </p>
        <p>
          {personalizeMessage(
            settings.wallet[editingLanguage],
            editingLanguage === 'ar' ? 'مريم' : 'Mariam',
            config.merchantName,
          )}
        </p>
        <h3>{ar ? 'قوالب واتساب' : 'WhatsApp templates'}</h3>
        <label>
          {ar ? 'نوع الرسالة' : 'Message purpose'}
          <Select value={purpose} onChange={(e) => setPurpose(e.target.value as WhatsAppPurpose)}>
            {Object.entries(labels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <label>
          {ar ? 'النص الجاهز' : 'Default message'}
          <textarea
            dir={editingLanguage === 'ar' ? 'rtl' : 'ltr'}
            rows={4}
            required
            maxLength={800}
            value={settings.whatsapp[purpose][editingLanguage]}
            onChange={(e) =>
              setSettings({
                ...settings,
                whatsapp: {
                  ...settings.whatsapp,
                  [purpose]: { ...settings.whatsapp[purpose], [editingLanguage]: e.target.value },
                },
              })
            }
          />
        </label>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <button className="primary" disabled={busy}>
          {ar ? 'حفظ التذكيرات والقوالب' : 'Save reminders and templates'}
        </button>
      </form>
      {stats && (
        <>
          <h3>{ar ? 'آخر 30 يوم' : 'Last 30 days'}</h3>
          <p>
            {ar
              ? `${stats.customers} عميل قبلت الخدمة تذكيره · ${stats.returned} عميل رجع بعدها · ${stats.queued} في الانتظار · ${stats.failed} تعذر إرسالهم · ${stats.uncertain} محتاجين تأكيد`
              : `${stats.customers} customers with accepted reminders · ${stats.returned} returned afterwards · ${stats.queued} queued · ${stats.failed} failed · ${stats.uncertain} unconfirmed`}
          </p>
          <p className="muted">
            {ar
              ? 'قبول خدمة الإشعارات للمحاولة هو اللي بيتسجل هنا. ظهور الإشعار بيعتمد على إعدادات موبايل العميل. الرجوع بيتحسب بعملية مؤكدة بعد التذكير.'
              : 'Acceptance is recorded by the notification service. Display depends on the customer’s device settings. A return means a confirmed transaction after the reminder.'}
          </p>
        </>
      )}
      {config.recent.map((row) => (
        <div className="list-row" key={row.id}>
          <div>
            <strong>{row.alias}</strong>
            <small>
              {row.channel === 'apple' ? 'Apple Wallet' : 'Google Wallet'} ·{' '}
              {new Date(row.created_at).toLocaleString(lang)}
            </small>
          </div>
          <span>
            {row.returned_at
              ? ar
                ? 'رجع بعد التذكير'
                : 'Returned afterwards'
              : statuses[row.status]}
          </span>
        </div>
      ))}
    </section>
  );
}
