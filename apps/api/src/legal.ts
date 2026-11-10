import { legalAcceptanceInput } from '../../../packages/contracts/src/legal.js';
import { legalNotice } from '../../../packages/domain/src/legal.js';
import { requireCondition } from './errors.js';
export function acceptedLegal(body: unknown) {
  const accepted = legalAcceptanceInput.parse(body),
    notice = legalNotice(accepted.acceptedPrivacyLocale);
  requireCondition(
    accepted.acceptedPrivacyVersion === notice.acceptance.version &&
      accepted.acceptedPrivacyHash === notice.acceptance.hash,
    'PRIVACY_CHANGED',
    409,
  );
  return notice;
}
