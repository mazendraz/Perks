import type { ApiError } from './api.js';
import type { Language } from '../../../packages/contracts/src/index.js';
const labels: Record<string, [string, string]> = {
  alias: ['الاسم على الكارت', 'Card name'],
  name: ['اسم النشاط', 'Business name'],
  slug: ['رابط التسجيل', 'Enrollment slug'],
  contactEmail: ['بريد التواصل', 'Contact email'],
  acceptedTerms: ['الموافقة على الشروط', 'Terms acceptance'],
  acceptedTermsHash: ['نسخة الشروط', 'Terms version'],
  programId: ['البرنامج', 'Program'],
  quantity: ['عدد الأختام', 'Stamp quantity'],
  'purchaseReference.reference': ['رقم الإيصال', 'Receipt number'],
  'purchaseReference.businessDate': ['تاريخ الشراء', 'Purchase date'],
  code: ['كود المطابقة', 'Matching code'],
  reason: ['السبب', 'Reason'],
  'program.threshold': ['عدد أختام المكافأة', 'Reward threshold'],
  'program.rewardTitle': ['اسم المكافأة', 'Reward title'],
  'program.rewardTerms': ['شروط المكافأة', 'Reward terms'],
  'program.name': ['اسم البرنامج', 'Program name'],
  'program.maxPerTx': ['حد الأختام', 'Stamp limit'],
  'program.validityDays': ['مدة صلاحية المكافأة', 'Reward validity'],
  terms: ['شروط التسجيل', 'Enrollment terms'],
  branches: ['بيانات الفروع', 'Branch details'],
  staff: ['بيانات الفريق', 'Team details'],
};
export function fieldProps(error: ApiError | null, path: string) {
  const invalid = error?.fields.some((f) => f.path === path || f.path === 'data.' + path);
  return {
    name: path,
    'aria-invalid': invalid || undefined,
    'aria-describedby': invalid ? 'field-error-' + path : undefined,
  };
}
export function FieldErrors({
  error,
  lang,
  onNavigate,
}: {
  error: ApiError | null;
  lang: Language;
  onNavigate?: (path: string) => void;
}) {
  if (!error?.fields.length) return null;
  return (
    <ul className="field-errors" role="alert">
      {error.fields.map((field, index) => {
        const path = field.path.replace(/^data\./, ''),
          ar = lang === 'ar',
          array = /^(branches|staff)\.(\d+)(?:\.(\w+))?/.exec(path),
          detail = (
            {
              name: ['الاسم', 'Name'],
              address: ['العنوان', 'Address'],
              email: ['البريد', 'Email'],
              role: ['الدور', 'Role'],
              maxQty: ['حد الأختام', 'Stamp limit'],
              branchIndexes: ['الفروع المسموحة', 'Allowed branches'],
            } as Record<string, string[]>
          )[array?.[3] || '']?.[ar ? 0 : 1],
          label =
            labels[path.replace(/^award\./, '')]?.[ar ? 0 : 1] ||
            (array
              ? `${array[1] === 'branches' ? (ar ? 'الفرع' : 'Branch') : ar ? 'عضو الفريق' : 'Staff member'} ${Number(array[2]) + 1}${detail ? ': ' + detail : ''}`
              : ar
                ? 'البيانات المطلوبة'
                : 'Required details');
        return (
          <li id={'field-error-' + path} key={field.path + index}>
            <button
              type="button"
              className="text-button"
              onClick={(e) => {
                const form = e.currentTarget.closest('form');
                onNavigate?.(path);
                requestAnimationFrame(() => {
                  const input =
                    form?.elements.namedItem(path) ||
                    Array.from(form?.elements || []).find((el) =>
                      el.getAttribute('name')?.startsWith(path + '.'),
                    );
                  if (input instanceof HTMLElement) input.focus();
                });
              }}
            >
              {label}:{' '}
              {lang === 'ar'
                ? 'راجع القيمة المطلوبة وحدودها.'
                : 'Check the required value and its limits.'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
