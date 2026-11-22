import type { AnalyticsResponse } from '../../../../../packages/contracts/src/analytics.js';

/** Fixed demo numbers for "Preview with sample data". Never mixed with real numbers. */
export function sampleAnalytics(days: 7 | 30 | 90): AnalyticsResponse {
  const today = new Date();
  const iso = (n: number) => new Date(today.getTime() - n * 864e5).toISOString().slice(0, 10);
  const trend = Array.from({ length: days }, (_, i) => {
    const n = days - 1 - i,
      weekday = new Date(today.getTime() - n * 864e5).getUTCDay();
    const base = 22 + Math.round(6 * Math.sin(i * 1.3) + 4 * Math.sin(i * 0.37) + (i / days) * 6);
    return { day: iso(n), visits: base + (weekday === 4 || weekday === 5 ? 9 : 0) };
  });
  const visits = trend.reduce((a, d) => a + d.visits, 0);
  const sections = Object.fromEntries(
    [
      'actions',
      'kpis',
      'trend',
      'value',
      'segments',
      'atRisk',
      'segmentList',
      'customer',
      'funnel',
      'distribution',
      'branches',
      'heat',
      'messageImpact',
      'health',
      'cohorts',
      'export',
    ].map((k) => [k, true]),
  ) as AnalyticsResponse['sections'];
  return {
    period: { days, from: iso(days - 1), to: iso(0), timezone: 'Africa/Cairo' },
    updatedAt: today.toISOString(),
    statsRefreshedAt: today.toISOString(),
    cadence: { category: 'cafe', confirmed: true, gap: 7, risk: 14, lost: 45 },
    sections,
    actions: [
      { key: 'at_risk', count: 47 },
      { key: 'near_reward', count: 35 },
      { key: 'one_time', count: 40 },
      { key: 'reward_holder', count: 18 },
    ],
    kpis: {
      customers: 1284,
      active: Math.round(visits / 1.8),
      newCustomers: Math.round(days * 3.1),
      visits,
      returnRate: 37,
      typicalGapDays: 9,
      previous: {
        active: Math.round(visits / 2),
        newCustomers: Math.round(days * 2.7),
        visits: Math.round(visits * 0.87),
        returnRate: 33,
      },
    },
    trend,
    value: {
      returningVisits: Math.round(visits * 0.62),
      visitsAfterMessages: Math.round(visits * 0.08),
    },
    segments: {
      never: 96,
      new: 92,
      one_time: 359,
      regular: 214,
      at_risk: 47,
      lost: 186,
      reactivated: 21,
      near_reward: 35,
      reward_holder: 18,
      vip: 38,
    },
    atRisk: [
      { profileId: 's1', alias: 'محمد سامي', expectedGapDays: 5, sinceDays: 16, stampsToReward: 2 },
      { profileId: 's2', alias: 'سارة عادل', expectedGapDays: 7, sinceDays: 21, stampsToReward: 4 },
      { profileId: 's3', alias: 'يوسف حسن', expectedGapDays: 3, sinceDays: 10, stampsToReward: 1 },
      { profileId: 's4', alias: 'نور الدين', expectedGapDays: 4, sinceDays: 13, stampsToReward: 6 },
      { profileId: 's5', alias: 'هبة منير', expectedGapDays: 10, sinceDays: 28, stampsToReward: 3 },
    ],
    funnel: {
      status: 'ready',
      steps: [
        { key: 'registered', count: 1284 },
        { key: 'first_visit', count: 1078 },
        { key: 'second_visit', count: 719 },
        { key: 'reward_earned', count: 270 },
        { key: 'reward_redeemed', count: 212 },
      ],
    },
    distribution: { status: 'ready', buckets: [565, 270, 180, 110, 159] },
    heat: {
      status: 'ready',
      cells: [
        [18, 36, 24, 42, 36],
        [18, 30, 24, 36, 30],
        [12, 30, 24, 36, 30],
        [6, 24, 18, 36, 30],
        [12, 30, 24, 42, 36],
        [18, 36, 30, 54, 60],
        [12, 24, 36, 54, 54],
      ],
      quietest: { day: 3, slot: 0 },
    },
    health: {
      status: 'ready',
      score: 72,
      weakest: 'second_visit',
      parts: [
        { key: 'return', value: 37, target: 50, weight: 30 },
        { key: 'second_visit', value: 31, target: 50, weight: 25 },
        { key: 'completion', value: 25, target: 25, weight: 20 },
        { key: 'redemption', value: 79, target: 80, weight: 15 },
        { key: 'active', value: 41, target: 50, weight: 10 },
      ],
    },
    cohorts: {
      status: 'ready',
      rows: [
        { month: iso(150).slice(0, 7), first: 120, back30: 34 },
        { month: iso(120).slice(0, 7), first: 135, back30: 41 },
        { month: iso(90).slice(0, 7), first: 128, back30: 44 },
        { month: iso(60).slice(0, 7), first: 140, back30: 52 },
        { month: iso(30).slice(0, 7), first: 151, back30: 61 },
        { month: iso(0).slice(0, 7), first: 92, back30: 30 },
      ],
    },
    messageImpact: [{ audience: 'at_risk', sentAt: iso(12), recipients: 52, returned: 14 }],
    branches: [
      {
        id: 'b1',
        name: 'الفرع الرئيسي',
        visits: 412,
        newCustomers: 44,
        returnRate: 41,
        medianApprovalSeconds: 35,
        pending: 0,
      },
      {
        id: 'b2',
        name: 'فرع التجمع',
        visits: 268,
        newCustomers: 35,
        returnRate: 36,
        medianApprovalSeconds: 50,
        pending: 1,
      },
      {
        id: 'b3',
        name: 'فرع مدينة نصر',
        visits: 116,
        newCustomers: 13,
        returnRate: 29,
        medianApprovalSeconds: 480,
        pending: 6,
      },
    ],
  };
}
