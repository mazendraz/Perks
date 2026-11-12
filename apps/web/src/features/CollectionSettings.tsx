import { useEffect, useState, type FormEvent } from 'react';
import type { CollectionSettings as Rules } from '../../../../packages/contracts/src/commands.js';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';
import {
  distanceMeters,
  parseMapsPosition,
  SHORT_MAPS_LINK,
} from '../../../../packages/domain/src/geo.js';
// Ready-made ranges. Phone GPS inside a building is usually off by 10–50 m.
const RANGES = [
  { metres: 50, ar: 'محل صغير', en: 'Small shop' },
  { metres: 75, ar: 'محل عادي', en: 'Typical shop' },
  { metres: 100, ar: 'كافيه أو مطعم كبير', en: 'Large café' },
  { metres: 150, ar: 'جوه مول أو كمباوند', en: 'Mall or compound' },
];

type Stored = Rules & { revision: number };
interface Branch {
  id: string;
  name: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  radius: number;
}
// What a given combination of switches means, in the shop owner's words.
export function describeRules(rules: Rules, ar: boolean) {
  const auto = !rules.requireCashier;
  if (!auto && rules.requireLocation)
    return {
      level: 'strong' as const,
      text: ar
        ? 'العميل لازم يكون جوه نطاق الفرع، وبعدها الكاشير يوافق على الختم.'
        : 'The customer must be inside the branch zone, then the cashier approves the stamp.',
    };
  if (!auto)
    return {
      level: 'strong' as const,
      text: ar
        ? 'كل ختم بموافقة الكاشير. العميل يلمس الستيكر ويستنى الموافقة.'
        : 'Every stamp is approved by the cashier. The customer taps the sticker and waits.',
    };
  if (rules.requireLocation)
    return {
      level: 'medium' as const,
      text: ar
        ? 'الختم بينزل لوحده لو العميل جوه نطاق الفرع. الموقع ممكن يتزوّر، فالحد اليومي هو خط الدفاع التاني.'
        : 'The stamp is added automatically inside the branch zone. Location can be faked, so the daily limit is the second line of defence.',
    };
  return {
    level: 'weak' as const,
    text: ar
      ? 'الختم بينزل لأي حد معاه لينك الستيكر، حتى لو مش في المحل. الحماية الوحيدة هي الحد اليومي.'
      : 'Anyone holding the sticker link gets the stamp, even away from the shop. The daily limit is the only protection.',
  };
}
const Number_ = ({
  label,
  value,
  onChange,
  min,
  max,
  hint,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min: number;
  max: number;
  hint?: string;
}) => (
  <label>
    {label}
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={value ?? ''}
      placeholder={hint}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  </label>
);
export function CollectionSettings({ merchantId, lang }: { merchantId: string; lang: Language }) {
  const ar = lang === 'ar',
    path = '/platform/merchants/' + merchantId + '/stamp-collection-settings';
  const [rules, setRules] = useState<Stored | null>(null),
    [branches, setBranches] = useState<Branch[]>([]),
    [positions, setPositions] = useState<Record<string, { text: string; radius: number }>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(''),
    [checks, setChecks] = useState<Record<string, string>>({});
  const load = async () => {
    try {
      const data = await api<{ settings: Stored; branches: Branch[] }>(path);
      setRules(data.settings);
      setBranches(data.branches);
      setPositions(
        Object.fromEntries(
          data.branches.map((b) => [
            b.id,
            {
              text: b.latitude === null ? '' : b.latitude + ', ' + b.longitude,
              radius: b.radius,
            },
          ]),
        ),
      );
      setError('');
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    void load();
  }, [merchantId]);
  if (!rules)
    return error ? (
      <p className="notice error" role="alert">
        {error}
      </p>
    ) : null;
  const set = (changes: Partial<Rules>) => {
    setSaved('');
    setRules({ ...rules, ...changes });
  };
  const auto = !rules.requireCashier,
    open = auto && !rules.requireLocation,
    summary = describeRules(rules, ar),
    missing = branches.filter((b) => b.status === 'active' && b.latitude === null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const { revision, ...body } = rules;
      const data = await api<{ settings: Stored }>(path, {
        method: 'PATCH',
        revision,
        body: {
          ...body,
          // Switched-off options are stored in their neutral state.
          openCollectionAcknowledged: open && body.openCollectionAcknowledged,
          maxStampsPerCollection: body.allowMultiple
            ? Math.max(body.maxStampsPerCollection, body.defaultStamps)
            : 100,
        },
      });
      setRules(data.settings);
      setSaved(ar ? 'إعدادات جمع الأختام اتحفظت.' : 'Stamp collection settings saved.');
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  const savePosition = async (branch: Branch) => {
    const entry = positions[branch.id]!,
      text = entry.text.trim();
    setBusy(true);
    setError('');
    setSaved('');
    try {
      let position: { latitude: number | null; longitude: number | null } | null = text
        ? parseMapsPosition(text)
        : { latitude: null, longitude: null };
      // The phone's "Share" button gives a short link; the server follows it to the pin.
      if (!position && SHORT_MAPS_LINK.test(text))
        position = await api<{ latitude: number; longitude: number }>('/platform/maps/resolve', {
          method: 'POST',
          body: { url: text },
        });
      if (!position) {
        setError(
          ar
            ? 'مش قادرين نقرا الموقع. الصق لينك خرايط جوجل أو أرقام زي: 30.0444, 31.2357'
            : 'This position could not be read. Paste a Google Maps link or numbers like 30.0444, 31.2357',
        );
        return;
      }
      await api(
        path.replace('/stamp-collection-settings', '/branches/' + branch.id + '/position'),
        {
          method: 'PUT',
          body: { ...position, radius: entry.radius },
        },
      );
      await load();
      setSaved(ar ? 'موقع ' + branch.name + ' اتحفظ.' : branch.name + ' position saved.');
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  // Stand where a customer would stand and see what the server would decide.
  const test = (branch: Branch) => {
    if (branch.latitude === null || branch.longitude === null) return;
    setChecks((all) => ({ ...all, [branch.id]: ar ? 'بنحدد مكانك…' : 'Locating you…' }));
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        const distance = Math.round(
            distanceMeters(
              p.coords.latitude,
              p.coords.longitude,
              branch.latitude!,
              branch.longitude!,
            ),
          ),
          accuracy = Math.round(p.coords.accuracy),
          inside = distance <= branch.radius,
          precise = accuracy <= rules!.maxAccuracy;
        setChecks((all) => ({
          ...all,
          [branch.id]: ar
            ? `إنت على بعد ${distance} متر من نقطة الفرع، ودقة موبايلك ${accuracy} متر. ` +
              (!precise
                ? 'الدقة أضعف من المسموح، فالختم مش هيتحسب. اطلع جنب الشباك أو شغّل الـ Wi-Fi.'
                : inside
                  ? 'العميل هنا هياخد ختمه ✓'
                  : `برّه النطاق (${branch.radius} متر). لو ده جوه المحل، كبّر النطاق.`)
            : `You are ${distance} m from the branch point, with ${accuracy} m phone accuracy. ` +
              (!precise
                ? 'Accuracy is worse than allowed, so no stamp. Move near a window or turn on Wi-Fi.'
                : inside
                  ? 'A customer here gets the stamp ✓'
                  : `Outside the ${branch.radius} m range. If this is inside the shop, widen it.`),
        }));
      },
      () =>
        setChecks((all) => ({
          ...all,
          [branch.id]: ar ? 'مقدرناش نجيب موقعك.' : 'Your position is unavailable.',
        })),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  };
  const here = (branch: Branch) =>
    navigator.geolocation?.getCurrentPosition(
      (p) =>
        setPositions((all) => ({
          ...all,
          [branch.id]: {
            ...all[branch.id]!,
            text: p.coords.latitude.toFixed(6) + ', ' + p.coords.longitude.toFixed(6),
          },
        })),
      () =>
        setError(
          ar
            ? 'مقدرناش نجيب موقعك. اكتب الإحداثيات يدوي.'
            : 'Your position is unavailable. Enter it manually.',
        ),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  return (
    <div className="stack collection-settings">
      <form className="panel" onSubmit={(e) => void save(e)}>
        <h2>{ar ? 'إعدادات جمع الأختام' : 'Stamp collection settings'}</h2>
        <p className="muted">
          {ar
            ? 'كل اختيار مستقل. فعّل اللي اتفقت عليه مع صاحب المحل.'
            : 'Each option is independent. Turn on what you agreed with the owner.'}
        </p>
        <p className={'notice collection-level ' + summary.level} role="status">
          {summary.text}
        </p>
        <fieldset>
          <label className="check">
            <input
              type="checkbox"
              checked={rules.requireLocation}
              onChange={(e) => set({ requireLocation: e.target.checked })}
            />
            <span>
              <strong>{ar ? 'التحقق من الموقع' : 'Require location verification'}</strong>
              <small>
                {ar
                  ? 'العميل لازم يكون جوه نطاق الفرع. لو مقفول، مش بنطلب الموقع خالص.'
                  : 'The customer must be inside the branch zone. When off, location is never asked.'}
              </small>
            </span>
          </label>
          {rules.requireLocation && (
            <>
              <Number_
                label={ar ? 'أقل دقة مقبولة للموقع (متر)' : 'Worst accepted accuracy (metres)'}
                value={rules.maxAccuracy}
                min={20}
                max={500}
                onChange={(v) => set({ maxAccuracy: v ?? 100 })}
              />
              {missing.length > 0 && (
                <p className="notice error">
                  {ar
                    ? 'حدد موقع كل الفروع النشطة تحت الأول: ' +
                      missing.map((b) => b.name).join('، ')
                    : 'Set a position for every active branch below first: ' +
                      missing.map((b) => b.name).join(', ')}
                </p>
              )}
            </>
          )}
        </fieldset>
        <fieldset>
          <label className="check">
            <input
              type="checkbox"
              checked={rules.requireCashier}
              onChange={(e) =>
                set({
                  requireCashier: e.target.checked,
                  ...(!e.target.checked && rules.collectionsPerDay === null
                    ? { collectionsPerDay: 1 }
                    : {}),
                  ...(!e.target.checked && rules.defaultStamps > 3 ? { defaultStamps: 1 } : {}),
                })
              }
            />
            <span>
              <strong>{ar ? 'موافقة الكاشير' : 'Require cashier approval'}</strong>
              <small>
                {ar
                  ? 'الطلب يفضل مستني لحد ما الكاشير يوافق. لو مقفول، الختم بينزل لوحده بعد باقي الشروط.'
                  : 'The request waits for the cashier. When off, the stamp is added automatically once the other rules pass.'}
              </small>
            </span>
          </label>
          {open && (
            <label className="check">
              <input
                type="checkbox"
                checked={rules.openCollectionAcknowledged}
                onChange={(e) => set({ openCollectionAcknowledged: e.target.checked })}
              />
              <span>
                <strong>
                  {ar
                    ? 'صاحب المحل موافق على الختم من غير تحقق'
                    : 'The owner accepts unverified collection'}
                </strong>
                <small>
                  {ar
                    ? 'من غير موقع ولا كاشير، أي حد معاه لينك الستيكر ياخد ختمه اليومي. لازم الموافقة دي عشان تحفظ.'
                    : 'With neither location nor cashier, anyone with the link gets the daily stamp. This confirmation is required to save.'}
                </small>
              </span>
            </label>
          )}
          {auto && (
            <Number_
              label={
                ar
                  ? 'أقصى أختام تلقائية للفرع في الساعة (بعدها العميل يروح للكاشير)'
                  : 'Automatic stamps per branch per hour (then customers go to the cashier)'
              }
              value={rules.autoBranchHourlyCap}
              min={1}
              max={1000}
              onChange={(v) => set({ autoBranchHourlyCap: v ?? 60 })}
            />
          )}
        </fieldset>
        <fieldset>
          <legend>{ar ? 'عدد المرات والحدود' : 'Frequency and limits'}</legend>
          <div className="form-grid">
            <Number_
              label={ar ? 'عدد مرات جمع الأختام في اليوم' : 'Collections per day'}
              value={rules.collectionsPerDay}
              min={1}
              max={50}
              hint={ar ? 'من غير حد' : 'No limit'}
              onChange={(v) => set({ collectionsPerDay: v })}
            />
            <Number_
              label={ar ? 'أقصى عدد أختام في اليوم' : 'Stamps per day'}
              value={rules.stampsPerDay}
              min={1}
              max={200}
              hint={ar ? 'من غير حد' : 'No limit'}
              onChange={(v) => set({ stampsPerDay: v })}
            />
            <Number_
              label={
                ar
                  ? 'وقت الانتظار بين كل مرة والتانية (دقيقة)'
                  : 'Cooldown between collections (minutes)'
              }
              value={rules.cooldownMinutes}
              min={0}
              max={1440}
              onChange={(v) => set({ cooldownMinutes: v ?? 0 })}
            />
            <label>
              {ar ? 'اليوم بيتحسب إزاي' : 'How a day is counted'}
              <select
                value={rules.limitWindow}
                onChange={(e) => set({ limitWindow: e.target.value as Rules['limitWindow'] })}
              >
                <option value="local_day">
                  {ar ? 'بتاريخ اليوم في توقيت المحل' : 'Calendar day in the shop’s time zone'}
                </option>
                <option value="rolling_24h">{ar ? 'كل 24 ساعة' : 'Rolling 24 hours'}</option>
              </select>
            </label>
            <Number_
              label={ar ? 'عدد الأختام في المرة الواحدة' : 'Stamps per collection'}
              value={rules.defaultStamps}
              min={1}
              max={auto ? 3 : 10}
              onChange={(v) => set({ defaultStamps: v ?? 1 })}
            />
          </div>
          {auto && rules.collectionsPerDay === null && (
            <p className="notice error">
              {ar
                ? 'الختم التلقائي لازم له حد يومي لعدد المرات.'
                : 'Automatic stamps need a daily collection limit.'}
            </p>
          )}
        </fieldset>
        <fieldset>
          <label className="check">
            <input
              type="checkbox"
              checked={rules.allowMultiple}
              onChange={(e) => set({ allowMultiple: e.target.checked })}
            />
            <span>
              <strong>{ar ? 'أكتر من ختم في العملية' : 'Multiple stamps'}</strong>
              <small>
                {ar
                  ? 'الكاشير يقدر يدّي أكتر من ختم للطلب الكبير. لو مقفول، كل عملية بتدّي العدد المحدد بس.'
                  : 'The cashier may give more stamps for a larger order. When off, every collection gives the set number only.'}
              </small>
            </span>
          </label>
          {rules.allowMultiple && (
            <Number_
              label={
                ar ? 'أقصى أختام يديها الكاشير في العملية' : 'Maximum stamps per cashier collection'
              }
              value={rules.maxStampsPerCollection}
              min={rules.defaultStamps}
              max={100}
              onChange={(v) => set({ maxStampsPerCollection: v ?? 100 })}
            />
          )}
        </fieldset>
        <fieldset>
          <label className="check">
            <input
              type="checkbox"
              checked={rules.welcomeStamps > 0}
              onChange={(e) => set({ welcomeStamps: e.target.checked ? 1 : 0 })}
            />
            <span>
              <strong>{ar ? 'ختم ترحيب' : 'Welcome stamp'}</strong>
              <small>
                {ar
                  ? 'العميل ياخده مرة واحدة بس أول ما يسجّل.'
                  : 'Given once only, when the customer first joins.'}
              </small>
            </span>
          </label>
          {rules.welcomeStamps > 0 && (
            <Number_
              label={ar ? 'عدد أختام الترحيب' : 'Welcome stamps'}
              value={rules.welcomeStamps}
              min={1}
              max={10}
              onChange={(v) => set({ welcomeStamps: v ?? 1 })}
            />
          )}
        </fieldset>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="notice success" role="status">
            {saved}
          </p>
        )}
        <button
          className="primary"
          disabled={
            busy ||
            (rules.requireLocation && missing.length > 0) ||
            (open && !rules.openCollectionAcknowledged) ||
            (auto && rules.collectionsPerDay === null)
          }
        >
          {ar ? 'احفظ الإعدادات' : 'Save settings'}
        </button>
      </form>
      <section className="panel">
        <h2>{ar ? 'مواقع الفروع' : 'Branch positions'}</h2>
        <ol className="muted position-steps">
          <li>
            {ar
              ? 'افتح خرايط جوجل على مكان المحل، ودوس «مشاركة» وانسخ الرابط، أو دوس مطوّل على المحل وانسخ الأرقام.'
              : 'Open Google Maps on the shop, tap Share and copy the link, or long-press the shop and copy the numbers.'}
          </li>
          <li>{ar ? 'الصقه هنا واختار النطاق.' : 'Paste it here and choose the range.'}</li>
          <li>
            {ar
              ? 'وإنت جوه المحل، دوس «جرّب من مكاني» عشان تتأكد إن العميل هياخد ختمه.'
              : 'Inside the shop, tap “Test from here” to confirm a customer would get the stamp.'}
          </li>
        </ol>
        {branches.map((branch) => {
          const entry = positions[branch.id] ?? { text: '', radius: 75 },
            set = (changes: Partial<typeof entry>) =>
              setPositions((all) => ({ ...all, [branch.id]: { ...entry, ...changes } }));
          return (
            <div className="branch-position" key={branch.id}>
              <div className="branch-position-title">
                <strong>
                  {branch.name}
                  {branch.status !== 'active' && (ar ? ' (موقوف)' : ' (disabled)')}
                </strong>
                <span className={'position-state' + (branch.latitude === null ? ' missing' : '')}>
                  {branch.latitude === null
                    ? ar
                      ? 'من غير موقع'
                      : 'No position'
                    : (ar ? 'متحدد · ' : 'Set · ') + branch.radius + (ar ? ' متر' : ' m')}
                </span>
              </div>
              <label>
                {ar ? 'لينك خرايط جوجل أو الإحداثيات' : 'Google Maps link or coordinates'}
                <input
                  dir="ltr"
                  lang="en"
                  inputMode="url"
                  autoComplete="off"
                  placeholder="https://maps.app.goo.gl/…  ·  30.0444, 31.2357"
                  value={entry.text}
                  onChange={(e) => set({ text: e.target.value })}
                />
              </label>
              <div className="range-choices" role="radiogroup" aria-label={ar ? 'النطاق' : 'Range'}>
                {RANGES.map((range) => (
                  <button
                    type="button"
                    key={range.metres}
                    role="radio"
                    aria-checked={entry.radius === range.metres}
                    className={entry.radius === range.metres ? 'active' : ''}
                    onClick={() => set({ radius: range.metres })}
                  >
                    <strong>
                      {range.metres} {ar ? 'متر' : 'm'}
                    </strong>
                    <small>{ar ? range.ar : range.en}</small>
                  </button>
                ))}
              </div>
              <details>
                <summary>{ar ? 'نطاق تاني' : 'Another range'}</summary>
                <Number_
                  label={ar ? 'النطاق (متر)' : 'Range (metres)'}
                  value={entry.radius}
                  min={20}
                  max={1000}
                  onChange={(v) => set({ radius: v ?? 75 })}
                />
              </details>
              <div className="form-actions position-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !entry.text.trim()}
                  onClick={() => void savePosition(branch)}
                >
                  {ar ? 'احفظ موقع الفرع' : 'Save branch position'}
                </button>
                <button type="button" className="secondary" onClick={() => here(branch)}>
                  {ar ? 'استخدم موقعي الحالي' : 'Use my current position'}
                </button>
                {branch.latitude !== null && (
                  <>
                    <button type="button" className="secondary" onClick={() => test(branch)}>
                      {ar ? 'جرّب من مكاني' : 'Test from here'}
                    </button>
                    <a
                      className="text-button"
                      target="_blank"
                      rel="noreferrer"
                      href={
                        'https://www.google.com/maps?q=' + branch.latitude + ',' + branch.longitude
                      }
                    >
                      {ar ? 'شوفه على الخريطة' : 'View on map'}
                    </a>
                  </>
                )}
              </div>
              {checks[branch.id] && (
                <p className="notice" role="status">
                  {checks[branch.id]}
                </p>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
