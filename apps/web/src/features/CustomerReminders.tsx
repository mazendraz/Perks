import { useEffect, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import {
  walletReminderText,
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
// Preview data: a customer two stamps away from the reward.
const sampleCard = (lang: 'ar' | 'en', business: string) => ({
  customer_name: lang === 'ar' ? 'مريم' : 'Mariam',
  merchant_name: business,
  threshold: 8,
  display_balance: 6,
  reward_title: lang === 'ar' ? 'قهوة مجانًا' : 'a free coffee',
});
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
            ? 'الغياب بيتحسب من آخر شراء أو ختم مؤكد. أول تذكير بيوصل بعد الأيام اللي تختارها، والباقي بينهم المدة اللي تحددها، ولما العميل يرجع بيقف لوحده. بيوصل بس للعملاء الموافقين على التذكيرات.'
            : 'Absence counts from the latest confirmed purchase or stamp. The first reminder goes after the days you choose, the rest are spaced as you set, and they stop once the customer comes back. Only customers who opted in receive them.'}
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
            {ar ? 'كل كام يوم بعد كده؟' : 'Then every … days'}
            <input
              type="number"
              min={2}
              max={365}
              required
              value={settings.cooldownDays}
              onChange={(e) => setSettings({ ...settings, cooldownDays: e.target.valueAsNumber })}
            />
          </label>
          <label>
            {ar ? 'أقصى عدد تذكيرات في الغيبة' : 'Most reminders per absence'}
            <Select
              value={String(settings.maxReminders)}
              onChange={(e) => setSettings({ ...settings, maxReminders: Number(e.target.value) })}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
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
        <p>
          {walletReminderText(
            settings,
            { ...sampleCard(editingLanguage, config.merchantName), pending_rewards: 0 },
            editingLanguage,
          )}
        </p>
        <label>
          {ar ? 'رسالة لما المكافأة تكون جاهزة' : 'Message when a reward is waiting'}
          <textarea
            dir={editingLanguage === 'ar' ? 'rtl' : 'ltr'}
            required
            maxLength={800}
            rows={3}
            value={settings.walletReady[editingLanguage]}
            onChange={(e) =>
              setSettings({
                ...settings,
                walletReady: { ...settings.walletReady, [editingLanguage]: e.target.value },
              })
            }
          />
        </label>
        <p>
          {walletReminderText(
            settings,
            { ...sampleCard(editingLanguage, config.merchantName), pending_rewards: 1 },
            editingLanguage,
          )}
        </p>
        <p className="muted">
          {ar
            ? 'استخدم {name} لاسم العميل، {business} لاسم المحل، {left} للأختام الفاضلة (زي «ختمين»)، و{reward} للمكافأة. كل عميل بيوصله الرسالة بأرقامه هو وبلغته.'
            : 'Use {name} for the customer, {business} for the business, {left} for the stamps left (like “2 stamps”) and {reward} for the reward. Each customer gets their own numbers, in their language.'}
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
