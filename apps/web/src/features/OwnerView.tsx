import { useEffect, useState } from 'react';
import type { Grant, Language } from '../../../../packages/contracts/src/index.js';
import { Icon } from '../../../../packages/ui/src/Icon.js';
import { api, errorText, setOwnerPreview } from '../api.js';
import { navigate } from '../useRoute.js';
import { MerchantPage } from './MerchantPage.js';
interface Preview {
  owner: { id: string; name: string; email: string };
  grant: Grant;
  readOnly: true;
}
export function OwnerView({ merchantId, lang }: { merchantId: string; lang: Language }) {
  const ar = lang === 'ar';
  const [data, setData] = useState<Preview | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    void api<Preview>('/platform/merchants/' + merchantId + '/owner-preview')
      .then((result) => {
        if (!active) return;
        setOwnerPreview({ merchantId, staffId: result.grant.id });
        setData(result);
      })
      .catch((e) => {
        if (active) setError(errorText(e, lang));
      });
    return () => {
      active = false;
      setOwnerPreview(null);
    };
  }, [merchantId]);
  return (
    <div className="app-layout workspace-merchant owner-view">
      <aside className="sidebar">
        <div className="sidebar-identity">
          <span className="workspace-avatar">{data?.grant.name.slice(0, 1) || 'N'}</span>
          <div>
            <strong>{data?.grant.name || (ar ? 'واجهة المالك' : 'Owner view')}</strong>
            <small>YOUR WORKSPACE</small>
          </div>
        </div>
        <div className="sidebar-title">{ar ? 'مساحة العمل' : 'Workspace'}</div>
        <nav aria-label={ar ? 'التنقل الرئيسي' : 'Main navigation'}>
          <button aria-current="page">
            <Icon name="shop" />
            {ar ? 'لوحة التاجر' : 'Merchant dashboard'}
          </button>
          <button onClick={() => navigate('/platform')}>
            <Icon name="shield" />
            {ar ? 'الرجوع لإدارة المنصة' : 'Back to platform'}
          </button>
        </nav>
        <div className="sidebar-foot">
          <span className="sidebar-emblem">
            <Icon name="spark" size={30} />
          </span>
          {ar ? 'علاقة بتكبر، زيارة ورا زيارة.' : 'Good visits. Lasting connections.'}
        </div>
      </aside>
      <main id="main" className="workspace-content">
        <section
          className="owner-preview-banner"
          aria-label={ar ? 'وضع معاينة المالك' : 'Owner preview mode'}
        >
          <div>
            <strong>
              {ar ? 'معاينة واجهة المالك' : 'Owner view preview'}
              {data ? ' · ' + data.grant.name : ''}
            </strong>
            <p>
              {data && (
                <>
                  <bdi>{data.owner.name}</bdi> · <bdi>{data.owner.email}</bdi> —{' '}
                </>
              )}
              {ar
                ? 'نفس لوحة المالك وبياناته. المعاينة للمراجعة؛التغييرات الفعلية من ملف المحل.'
                : 'The owner’s dashboard and data. Review here; save actual changes from the business workspace.'}
            </p>
          </div>
          <button
            className="secondary small"
            onClick={() => navigate('/platform?merchant=' + merchantId)}
          >
            {ar ? 'تعديل المحل من المنصة' : 'Edit business in platform'}
          </button>
        </section>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {!data && !error && (
          <p role="status">{ar ? 'بنفتح واجهة المالك…' : 'Loading owner view…'}</p>
        )}
        {data && <MerchantPage key={data.grant.id} grant={data.grant} lang={lang} />}
      </main>
    </div>
  );
}
