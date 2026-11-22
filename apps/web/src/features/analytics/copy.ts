// Every word on the analytics page, in one place, so the Arabic can be reviewed as a whole.
// Egyptian Arabic, plain and short; English mirrors the meaning, not the words.
import type {
  ActionCard,
  FunnelStep,
  SegmentKey,
} from '../../../../../packages/contracts/src/analytics.js';
import type { Language } from '../../../../../packages/contracts/src/index.js';

type T = { ar: string; en: string };
export const pick = (t: T, lang: Language) => (lang === 'ar' ? t.ar : t.en);
const fill = (s: string, v: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));
export const say = (t: T, lang: Language, v: Record<string, string | number> = {}) =>
  fill(pick(t, lang), v);

export const copy = {
  eyebrow: { ar: 'التحليلات', en: 'Analytics' },
  title: { ar: 'زباينك النهارده', en: 'Your customers today' },
  updated: { ar: 'اتحدّثت {time}', en: 'Updated {time}' },
  period: { ar: 'الفترة', en: 'Period' },
  periods: {
    7: { ar: '7 أيام', en: '7 days' },
    30: { ar: '30 يوم', en: '30 days' },
    90: { ar: '3 شهور', en: '3 months' },
  } as Record<number, T>,
  allBranches: { ar: 'كل الفروع', en: 'All branches' },
  branch: { ar: 'الفرع', en: 'Branch' },
  retry: { ar: 'حاول تاني', en: 'Try again' },
  loading: { ar: 'بنجهّز الأرقام…', en: 'Getting your numbers…' },

  todo: { ar: 'النهارده تعمل إيه؟', en: 'What to do today' },
  todoTitle: {
    ar: 'عندك فرص ترجّع بيها زباين',
    en: 'Chances to bring customers back',
  },
  todoNone: {
    ar: 'مفيش حاجة مستعجلة النهارده. زباينك ماشيين في مواعيدهم.',
    en: 'Nothing urgent today. Your customers are on their usual rhythm.',
  },
  actions: {
    at_risk: {
      unit: { ar: 'زبون اتأخروا', en: 'customers are late' },
      text: {
        ar: 'كانوا بييجوا بانتظام وغابوا أكتر من عادتهم. رسالة صغيرة على الـWallet ممكن ترجّعهم.',
        en: 'They used to come regularly and are now later than usual. A short Wallet message can bring them back.',
      },
      cta: { ar: 'ابعتلهم تذكير', en: 'Send a reminder' },
    },
    near_reward: {
      unit: { ar: 'زبون قرّبوا من الهدية', en: 'customers are close to a reward' },
      text: {
        ar: 'فاضلهم ختم أو ختمين. فكّرهم بس — من غير ما تدي خصم.',
        en: 'One or two stamps to go. A nudge is enough — no discount needed.',
      },
      cta: { ar: 'فكّرهم بالهدية', en: 'Remind them' },
    },
    one_time: {
      unit: { ar: 'زبون جم مرة واحدة', en: 'customers came only once' },
      text: {
        ar: 'الزيارة التانية هي أصعب خطوة. شجّعهم يرجعوا قبل ما ينسوا.',
        en: 'The second visit is the hardest step. Invite them back before they forget.',
      },
      cta: { ar: 'شجّعهم يرجعوا', en: 'Invite them back' },
    },
    reward_holder: {
      unit: { ar: 'زبون معاهم هدية', en: 'customers have a reward waiting' },
      text: {
        ar: 'استحقوا الهدية ولسه ماصرفوهاش. تذكير بسيط بيجيبهم.',
        en: 'They earned a reward and have not used it yet. A reminder brings them in.',
      },
      cta: { ar: 'فكّرهم ييجوا ياخدوها', en: 'Remind them to claim it' },
    },
  } satisfies Record<ActionCard['key'], { unit: T; text: T; cta: T }>,
  seeWho: { ar: 'شوف مين', en: 'See who' },
  sendToGroup: { ar: 'ابعت رسالة للمجموعة دي', en: 'Message this group' },
  lastMessage: {
    ar: 'آخر رسالة ليهم: رجع {returned} من {recipients} خلال أسبوعين.',
    en: 'Last message to them: {returned} of {recipients} came back within two weeks.',
  },

  kpis: {
    active: { ar: 'زباين جم', en: 'Customers who came' },
    visits: { ar: 'زيارات', en: 'Visits' },
    newCustomers: { ar: 'زباين جداد', en: 'New customers' },
    returnRate: { ar: 'نسبة الرجوع', en: 'Return rate' },
    customers: { ar: 'كل العملاء', en: 'All customers' },
    typicalGap: { ar: 'بيرجعوا كل', en: 'They come back every' },
  },
  hints: {
    active: {
      ar: 'عدد الزباين اللي جم مرة واحدة على الأقل في الفترة دي.',
      en: 'Customers who came at least once in this period.',
    },
    visits: {
      ar: 'الزيارة = زبون جه في يوم وأخد ختم (من الكاشير أو أوتوماتيك). كذا ختم في نفس اليوم = زيارة واحدة.',
      en: 'A visit is one customer on one day with at least one stamp (cashier or automatic). Several stamps that day are one visit.',
    },
    newCustomers: {
      ar: 'اللي سجلوا كارت جديد في الفترة دي.',
      en: 'People who joined in this period.',
    },
    returnRate: {
      ar: 'من اللي جم في الفترة دي، كام واحد كان جه قبل كده.',
      en: 'Of everyone who came in this period, how many had been before.',
    },
    customers: { ar: 'كل اللي معاهم كارت عندك.', en: 'Everyone who holds your card.' },
    typicalGap: {
      ar: 'المتوسط بين زيارات الزباين المنتظمين.',
      en: 'The typical time between visits of your regular customers.',
    },
  },
  days: { ar: '{n} يوم', en: '{n} days' },
  oneDay: { ar: 'يوم', en: 'day' },
  deltaCaption: {
    ar: 'الأسهم مقارنة بالـ{days} اللي قبلها.',
    en: 'Arrows compare with the previous {days}.',
  },
  deltaSame: { ar: 'زي الفترة اللي قبلها', en: 'Same as before' },
  deltaNew: { ar: 'مفيش أرقام قبلها', en: 'No earlier numbers' },

  trend: { ar: 'الزيارات', en: 'Visits' },
  trendCaption: {
    7: { ar: 'آخر 7 أيام · يوم بيوم', en: 'Last 7 days · daily' },
    30: { ar: 'آخر 30 يوم · يوم بيوم', en: 'Last 30 days · daily' },
    90: { ar: 'آخر 3 شهور · أسبوع بأسبوع', en: 'Last 3 months · weekly' },
  } as Record<number, T>,
  trendLabel: { ar: 'رسم الزيارات، الأرقام في الجدول', en: 'Visit chart; numbers in the table' },
  today: { ar: 'النهارده', en: 'Today' },
  weekOf: { ar: 'أسبوع {day}', en: 'Week of {day}' },

  valueEyebrow: { ar: 'اللي Perks رجّعهولك', en: 'What Perks brought back' },
  valueUnit: { ar: 'زيارة من زباين راجعين', en: 'visits from returning customers' },
  valueText: {
    ar: 'زباين كانوا جم قبل كده ورجعوا تاني في آخر {days}.',
    en: 'Customers who had been before and came back in the last {days}.',
  },
  valueMessages: {
    ar: '{n} منهم جم خلال أسبوعين من رسالة أو تذكير.',
    en: '{n} of them came within two weeks of a message or reminder.',
  },

  segmentsTitle: { ar: 'زباينك متقسمين لوحدهم', en: 'Your customers, sorted for you' },
  segmentsCaption: {
    ar: 'كل زبون بيتنقل لوحده مع كل زيارة.',
    en: 'Each customer moves by themselves with every visit.',
  },
  segments: {
    never: { ar: 'لسه مازاروش', en: 'Not visited yet' },
    new: { ar: 'جداد', en: 'New' },
    one_time: { ar: 'جم مرة بس', en: 'Came once' },
    regular: { ar: 'منتظمين', en: 'Regulars' },
    at_risk: { ar: 'اتأخروا', en: 'Late' },
    lost: { ar: 'بعدوا', en: 'Gone quiet' },
    reactivated: { ar: 'رجعوا تاني', en: 'Came back' },
    near_reward: { ar: 'قرّبوا من الهدية', en: 'Close to a reward' },
    reward_holder: { ar: 'معاهم هدية', en: 'Reward waiting' },
    vip: { ar: 'VIP', en: 'VIP' },
  } satisfies Record<SegmentKey, T>,
  segmentRules: {
    never: { ar: 'سجلوا ولسه ماجوش', en: 'Joined, no visit yet' },
    new: { ar: 'أول زيارة كانت قريب', en: 'First visit was recent' },
    one_time: { ar: 'زيارة واحدة ومارجعوش', en: 'One visit, no return yet' },
    regular: { ar: 'بييجوا في ميعادهم', en: 'Coming on their usual rhythm' },
    at_risk: { ar: 'غابوا أكتر من عادتهم', en: 'Later than their usual rhythm' },
    lost: { ar: 'غابوا فترة طويلة', en: 'Away for a long time' },
    reactivated: { ar: 'رجعوا بعد غياب طويل', en: 'Returned after a long gap' },
    near_reward: { ar: 'فاضلهم ختم أو ختمين', en: 'One or two stamps to go' },
    reward_holder: { ar: 'هدية مستحقة لسه ماتصرفتش', en: 'Earned, not yet claimed' },
    vip: { ar: 'أكتر الزباين زيارة', en: 'Your most frequent customers' },
  } satisfies Record<SegmentKey, T>,
  open: { ar: 'افتح', en: 'Open' },

  atRiskTitle: { ar: 'زباين اتأخروا عن عادتهم', en: 'Customers later than usual' },
  atRiskAll: { ar: 'عرض الكل ({n})', en: 'See all ({n})' },
  atRiskEmpty: { ar: 'مفيش حد متأخر دلوقتي.', en: 'Nobody is late right now.' },
  habit: { ar: 'بييجي كل {gap} · غايب {since}', en: 'Every {gap} · away {since}' },
  stampsLeft: { ar: 'فاضله {n}', en: '{n} to go' },

  funnelTitle: { ar: 'رحلة الزبون مع الكارت', en: 'The customer journey' },
  funnelCaption: { ar: 'من كل اللي سجلوا', en: 'Out of everyone who joined' },
  funnel: {
    registered: { ar: 'سجلوا', en: 'Joined' },
    first_visit: { ar: 'جم أول مرة', en: 'First visit' },
    second_visit: { ar: 'رجعوا مرة تانية', en: 'Came back' },
    reward_earned: { ar: 'استحقوا هدية', en: 'Earned a reward' },
    reward_redeemed: { ar: 'صرفوا الهدية', en: 'Claimed it' },
  } satisfies Record<FunnelStep['key'], T>,
  funnelDrop: {
    ar: 'أكبر وقعة بين «{from}» و«{to}»: {n} زبون وقفوا هنا.',
    en: 'The biggest drop is between “{from}” and “{to}”: {n} customers stop here.',
  },
  funnelTips: {
    registered: {
      ar: 'شجّع الناس تاخد أول ختم وهي في المحل.',
      en: 'Help people get their first stamp while they are still in the shop.',
    },
    first_visit: {
      ar: 'جرّب ختم ترحيب، أو تذكير بعد أيام من أول زيارة.',
      en: 'Try a welcome stamp, or a reminder a few days after the first visit.',
    },
    second_visit: {
      ar: 'الكارت ممكن يكون طويل. فكّر في أختام أقل أو ختمين في الزيارة.',
      en: 'The card may feel long. Consider fewer stamps or two per visit.',
    },
    reward_earned: {
      ar: 'فكّر اللي معاهم هدية ييجوا ياخدوها.',
      en: 'Remind people with a reward to come and claim it.',
    },
  } as Record<string, T>,

  distTitle: { ar: 'الزباين جم كام مرة؟', en: 'How many times did they come?' },
  distCaption: { ar: 'عدد العملاء حسب الزيارات', en: 'Customers by number of visits' },
  dist: [
    { ar: 'مرة', en: '1' },
    { ar: 'مرتين', en: '2' },
    { ar: '3 مرات', en: '3' },
    { ar: '4 مرات', en: '4' },
    { ar: '5+', en: '5+' },
  ] as T[],
  distOnce: {
    ar: '{pct}% من زباينك جم مرة واحدة بس — دي أسهل شريحة تكسب منها.',
    en: '{pct}% of your customers came only once — the easiest group to win back.',
  },

  heatTitle: { ar: 'أوقات الزحمة', en: 'Busy times' },
  heatCaption: {
    ar: 'آخر 3 شهور · كل ما المربع أغمق، الزيارات أكتر',
    en: 'Last 3 months · darker means more visits',
  },
  heatDays: [
    { ar: 'السبت', en: 'Sat' },
    { ar: 'الحد', en: 'Sun' },
    { ar: 'الاتنين', en: 'Mon' },
    { ar: 'التلات', en: 'Tue' },
    { ar: 'الأربع', en: 'Wed' },
    { ar: 'الخميس', en: 'Thu' },
    { ar: 'الجمعة', en: 'Fri' },
  ] as T[],
  heatSlots: [
    { ar: 'الصبح', en: 'Morning' },
    { ar: 'الضهر', en: 'Midday' },
    { ar: 'العصر', en: 'Afternoon' },
    { ar: 'المغرب', en: 'Evening' },
    { ar: 'بالليل', en: 'Night' },
  ] as T[],
  heatSlotHours: ['6–11', '11–2', '2–5', '5–8', '8–6'],
  heatQuiet: {
    ar: 'أهدى وقت: {day} {slot}. مناسب لعرض يجيب الناس في الوقت ده.',
    en: 'Quietest time: {day} {slot}. A good slot for an offer.',
  },
  heatCell: { ar: '{day} {slot}: {n} زيارة', en: '{day} {slot}: {n} visits' },

  branchesTitle: { ar: 'الفروع والكاشير', en: 'Branches and cashiers' },
  branchCols: {
    name: { ar: 'الفرع', en: 'Branch' },
    visits: { ar: 'زيارات', en: 'Visits' },
    newCustomers: { ar: 'جداد', en: 'New' },
    returnRate: { ar: 'نسبة الرجوع', en: 'Return rate' },
    approval: { ar: 'موافقة الكاشير', en: 'Cashier approval' },
    pending: { ar: 'مستنية', en: 'Waiting' },
  },
  seconds: { ar: '{n} ثانية', en: '{n}s' },
  minutes: { ar: '{n} دقيقة', en: '{n} min' },

  notEnough: {
    ar: 'محتاجين {need} على الأقل عشان الرقم ده يبقى مفيد — عندك {have} لحد دلوقتي.',
    en: 'This needs at least {need} to be useful — you have {have} so far.',
  },
  locked: { ar: 'الجزء ده مش في باقتك.', en: 'This part is not in your plan.' },

  emptyTitle: {
    ar: 'أول ما زباينك ياخدوا أختام، هتبان هنا',
    en: 'This fills up as customers collect stamps',
  },
  emptyText: {
    ar: 'هنوريك مين بيرجع، مين غاب، ومين قرّب من الهدية — وتقدر تبعتلهم بضغطة.',
    en: 'You will see who comes back, who is late and who is close to a reward — and reach them in one tap.',
  },
  sample: { ar: 'شوف شكلها بداتا تجريبية', en: 'Preview with sample data' },
  sampleBadge: { ar: 'داتا تجريبية', en: 'Sample data' },
  sampleExit: { ar: 'ارجع لأرقامك', en: 'Back to your numbers' },

  cadenceTitle: { ar: 'زباينك بيرجعوا كل قد إيه؟', en: 'How often do your customers come back?' },
  cadenceText: {
    ar: 'من الأرقام دي بنعرف مين اتأخر ومين بعد. كل زبون بيجيله ميعاده الخاص كمان بعد 3 زيارات.',
    en: 'These numbers tell us who is late and who has gone quiet. After 3 visits each customer also gets their own rhythm.',
  },
  cadenceBanner: {
    ar: 'اختار نوع نشاطك عشان نعرف إمتى الزبون يعتبر اتأخر.',
    en: 'Pick your kind of business so we know when a customer is late.',
  },
  cadencePick: { ar: 'اختار نوع النشاط', en: 'Choose your business' },
  category: { ar: 'نوع النشاط', en: 'Kind of business' },
  gapLabel: { ar: 'الزبون العادي بيرجع كل (يوم)', en: 'A usual customer comes back every (days)' },
  lostLabel: { ar: 'اعتبره بعد لو غاب (يوم)', en: 'Consider them gone after (days)' },
  cadenceDefault: {
    ar: 'الأرقام المتعارف عليها لـ{category}: كل {gap} يوم، ويعتبر بعد بعد {lost} يوم.',
    en: 'Usual numbers for {category}: every {gap} days, gone after {lost} days.',
  },
  cadenceNow: {
    ar: 'دلوقتي: الزبون يعتبر متأخر بعد {risk} يوم، وبعد خلاص بعد {lost} يوم.',
    en: 'Now: late after {risk} days, gone after {lost} days.',
  },
  save: { ar: 'احفظ', en: 'Save' },
  saved: { ar: 'اتحفظ. التقسيم هيتحدّث خلال دقايق.', en: 'Saved. Segments update within minutes.' },
  resetDefaults: { ar: 'رجّع الأرقام المتعارف عليها', en: 'Use the usual numbers' },
  edit: { ar: 'عدّل', en: 'Edit' },
  cancel: { ar: 'إلغاء', en: 'Cancel' },
  close: { ar: 'إغلاق', en: 'Close' },

  listSearch: { ar: 'دوّر بالاسم', en: 'Search by name' },
  listEmpty: { ar: 'مفيش حد هنا دلوقتي.', en: 'Nobody here right now.' },
  listMore: { ar: 'اعرض أكتر', en: 'Show more' },
  listCount: { ar: '{n} زبون', en: '{n} customers' },
  visitsCount: { ar: '{n} زيارة', en: '{n} visits' },
  lastVisit: { ar: 'آخر زيارة من {n}', en: 'Last visit {n} ago' },
  noVisit: { ar: 'لسه ماجاش', en: 'No visit yet' },
  details: { ar: 'أرقام التشغيل التفصيلية', en: 'Detailed operating numbers' },

  healthTitle: { ar: 'صحة برنامج الولاء', en: 'Loyalty programme health' },
  healthCaption: {
    ar: 'درجة من 100 بتقيس برنامجك على أهداف بسيطة. مؤشر يساعدك، مش حكم على المحل.',
    en: 'A score out of 100 against simple targets. A guide, not a verdict on your business.',
  },
  healthVerdict: [
    { min: 75, t: { ar: 'برنامجك ماشي ممتاز.', en: 'Your programme is doing great.' } },
    { min: 50, t: { ar: 'برنامجك ماشي كويس.', en: 'Your programme is doing well.' } },
    { min: 0, t: { ar: 'برنامجك محتاج شوية شغل.', en: 'Your programme needs some work.' } },
  ],
  healthWeakest: { ar: 'أضعف نقطة: {part}.', en: 'Weakest point: {part}.' },
  healthParts: {
    return: { ar: 'نسبة الرجوع', en: 'Return rate' },
    second_visit: { ar: 'الرجوع للزيارة التانية', en: 'Second visit' },
    completion: { ar: 'إكمال الكارت', en: 'Card completion' },
    redemption: { ar: 'صرف الهدايا', en: 'Rewards claimed' },
    active: { ar: 'الزباين النشطين', en: 'Active customers' },
  } as Record<string, T>,
  healthTips: {
    return: {
      ar: 'ابعت تذكير للي اتأخروا، وشجّع الزيارة الجاية بختم إضافي في وقت الهدوء.',
      en: 'Remind late customers and reward the next visit with an extra stamp at quiet times.',
    },
    second_visit: {
      ar: 'ركّز على اللي جم مرة واحدة: ختم ترحيب أو رسالة بعد أيام من أول زيارة.',
      en: 'Focus on one-time visitors: a welcome stamp or a message a few days after the first visit.',
    },
    completion: {
      ar: 'الكارت ممكن يكون طويل. جرّب أختام أقل للهدية.',
      en: 'The card may be long. Try fewer stamps per reward.',
    },
    redemption: {
      ar: 'فيه هدايا مستحقة ماتصرفتش. فكّر أصحابها ييجوا ياخدوها.',
      en: 'Some rewards are unclaimed. Remind their owners to come in.',
    },
    active: {
      ar: 'جزء كبير من زباينك بقالهم فترة. رسالة للي بعدوا ممكن تفرق.',
      en: 'Many customers have been away. A message to those gone quiet can help.',
    },
  } as Record<string, T>,
  healthTarget: { ar: 'الهدف', en: 'target' },
  cohortsTitle: { ar: 'الزباين الجداد بيرجعوا؟', en: 'Do new customers come back?' },
  cohortsCaption: {
    ar: 'من اللي جم أول مرة في كل شهر، كام واحد رجع خلال 30 يوم.',
    en: 'Of those who first came each month, how many returned within 30 days.',
  },
  cohortsRow: { ar: '{back} من {first}', en: '{back} of {first}' },
  cohortsPartial: { ar: 'الشهر ده لسه مكملش.', en: 'This month is still running.' },
  exportCsv: { ar: 'نزّل التقرير (CSV)', en: 'Download report (CSV)' },
  calcTitle: { ar: 'عايز تشوفها بالفلوس؟', en: 'See it in money?' },
  calcLabel: { ar: 'متوسط الفاتورة عندك', en: 'Your average bill' },
  calcResult: { ar: '≈ {amount} تقديري', en: '≈ {amount} estimated' },
  calcPrivate: {
    ar: 'الرقم ده بيتحفظ على جهازك بس. مش بيتبعت لينا ولا لحد.',
    en: 'This number stays on this device only. It is never sent to us or anyone.',
  },
};

/** "3 أيام", "يومين", "15 يوم" — Arabic counts change the word, English just the s. */
export const daysText = (n: number, lang: Language) => {
  if (lang === 'en') return n === 1 ? '1 day' : n + ' days';
  if (n === 1) return 'يوم';
  if (n === 2) return 'يومين';
  if (n >= 3 && n <= 10) return n + ' أيام';
  return n + ' يوم';
};

export const stampsText = (n: number, lang: Language) => {
  if (lang === 'en') return n === 1 ? '1 stamp' : n + ' stamps';
  if (n === 1) return 'ختم واحد';
  if (n === 2) return 'ختمين';
  if (n >= 3 && n <= 10) return n + ' أختام';
  return n + ' ختم';
};
