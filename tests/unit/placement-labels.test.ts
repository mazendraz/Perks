import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enrollmentPlacementLabel,
  placementDisplayLabel,
} from '../../packages/domain/src/placement-labels.js';
test('automatic enrollment names follow the selected locale while existing defaults and custom names remain safe', () => {
  const branch = 'فرع تجريبي';
  assert.equal(enrollmentPlacementLabel(branch, 'ar'), 'تسجيل العملاء • فرع تجريبي');
  assert.equal(
    placementDisplayLabel('Enrollment • ' + branch, branch, 'ar'),
    'تسجيل العملاء • فرع تجريبي',
  );
  assert.equal(
    placementDisplayLabel('تسجيل العملاء • ' + branch, branch, 'en'),
    'Enrollment • فرع تجريبي',
  );
  for (const custom of ['واجهة الكاشير', 'Enrollment poster', 'Enrollment • فرع مختلف'])
    assert.equal(placementDisplayLabel(custom, branch, 'ar'), custom);
});
