import type { Category, LedgerData, Tx, TxType } from '@/types';
import { isoNow, uid } from '@/utils/id';
import { addDays, nowStr, todayStr } from '@/utils/date';

/**
 * 演示数据生成器
 * 用途：首次体验图表/统计效果，或二次开发时快速造样本。
 * 生成结果全部落在当前账本，可在「设置 → 数据 → 清空」一键移除。
 */

/** 可复现伪随机（mulberry32），保证每次生成的演示数据结构稳定 */
function createRandom(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Plan {
  categoryKey: string;
  count: [number, number];
  amount: [number, number];
  note?: string[];
  merchant?: string[];
}

const EXPENSE_PLANS: Plan[] = [
  { categoryKey: 'cat_food_1', count: [1, 2], amount: [1200, 3800], note: ['早午晚餐', '公司楼下'], merchant: ['食堂', '沙县小吃', '兰州拉面'] },
  { categoryKey: 'cat_food_8', count: [0, 1], amount: [2200, 4500], note: ['外卖'], merchant: ['美团外卖', '饿了么'] },
  { categoryKey: 'cat_food_6', count: [0, 1], amount: [800, 2500], note: ['奶茶', '咖啡'], merchant: ['瑞幸', '蜜雪冰城'] },
  { categoryKey: 'cat_traffic_1', count: [0, 2], amount: [400, 1200], note: ['通勤'], merchant: ['地铁'] },
  { categoryKey: 'cat_traffic_2', count: [0, 1], amount: [1500, 5200], note: ['打车'], merchant: ['滴滴'] },
  { categoryKey: 'cat_shopping_1', count: [0, 1], amount: [3000, 15000], note: ['日用品'], merchant: ['超市', '京东'] },
  { categoryKey: 'cat_home_4', count: [0, 1], amount: [5000, 12000], note: ['电费'] },
  { categoryKey: 'cat_fun_1', count: [0, 1], amount: [3500, 9000], note: ['电影'], merchant: ['万达影城'] },
  { categoryKey: 'cat_medical_2', count: [0, 1], amount: [2000, 8000], note: ['药品'], merchant: ['药店'] },
  { categoryKey: 'cat_gift_1', count: [0, 1], amount: [5000, 30000], note: ['人情'] },
  { categoryKey: 'cat_edu_1', count: [0, 1], amount: [3000, 12000], note: ['书籍'], merchant: ['当当'] },
];

const INCOME_PLANS: Plan[] = [
  { categoryKey: 'cat_salary_1', count: [1, 1], amount: [900000, 1500000], note: ['月度工资'] },
  { categoryKey: 'cat_invest_1', count: [0, 1], amount: [3000, 26000], note: ['交通补贴'] },
  { categoryKey: 'cat_other_income_2', count: [0, 1], amount: [5000, 60000], note: ['报销', '退款'] },
];

const PROJECT_NAMES = ['日常', '学习提升', '家庭'];

export function buildDemoData(base: LedgerData): LedgerData {
  const bookId = base.settings.lastBookId ?? base.books[0]?.id;
  if (!bookId) return base;

  const categories = base.categories.filter((c) => !c.archived);
  const catById = new Map<string, Category>(categories.map((c) => [c.id, c]));
  const accounts = base.accounts.filter((a) => a.bookId === bookId && !a.archived);
  if (!accounts.length) return base;

  const projects = PROJECT_NAMES.map((name, index) => ({
    id: uid('prj'),
    bookId,
    name,
    color: ['#f0993e', '#7b8ff7', '#4bb3a0'][index],
    archived: false,
  }));

  const random = createRandom(20261023);
  const txs: Tx[] = [];
  const now = isoNow();
  const today = todayStr();

  const pick = <T,>(list: T[]): T => list[Math.floor(random() * list.length)];

  const makeTx = (plan: Plan, day: string, type: TxType) => {
    const category = catById.get(plan.categoryKey);
    if (!category) return;
    const [min, max] = plan.amount;
    const amount = Math.round(min + random() * (max - min));
    const hour = 8 + Math.floor(random() * 13);
    const minute = Math.floor(random() * 60);
    txs.push({
      id: uid('tx'),
      bookId,
      type,
      amount,
      categoryId: category.id,
      accountId: pick(accounts).id,
      toAccountId: null,
      projectId: random() > 0.7 ? pick(projects).id : null,
      merchant: plan.merchant ? pick(plan.merchant) : '',
      note: plan.note ? pick(plan.note) : '',
      occurredAt: `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      createdAt: now,
      updatedAt: now,
    });
  };

  // 覆盖近 95 天，保证「今天/本周/本月/本年」四个概览卡片都有数据
  for (let offset = 95; offset >= 0; offset -= 1) {
    const day = addDays(today, -offset);
    for (const plan of EXPENSE_PLANS) {
      const [minCount, maxCount] = plan.count;
      const n = minCount + Math.floor(random() * (maxCount - minCount + 1));
      for (let i = 0; i < n; i += 1) makeTx(plan, day, 'expense');
    }
    if (offset % 30 === 0) {
      for (const plan of INCOME_PLANS) {
        const [minCount, maxCount] = plan.count;
        const n = minCount + Math.floor(random() * (maxCount - minCount + 1));
        for (let i = 0; i < n; i += 1) makeTx(plan, day, 'income');
      }
    }
  }

  // 一条转账样本，验证账户间划转不影响收支统计
  const debit = accounts.find((a) => a.type === 'debit');
  const alipay = accounts.find((a) => a.type === 'alipay');
  if (debit && alipay) {
    txs.push({
      id: uid('tx'),
      bookId,
      type: 'transfer',
      amount: 100000,
      categoryId: null,
      accountId: debit.id,
      toAccountId: alipay.id,
      projectId: null,
      merchant: '',
      note: '转入支付宝备用',
      occurredAt: `${addDays(today, -3)}T09:20`,
      createdAt: now,
      updatedAt: now,
    });
  }

  txs.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  const budgets = [
    { id: uid('budget'), bookId, month: '*', categoryId: null, amount: 600000 },
    { id: uid('budget'), bookId, month: '*', categoryId: 'cat_food', amount: 150000 },
    { id: uid('budget'), bookId, month: '*', categoryId: 'cat_traffic', amount: 40000 },
  ];

  const templates = [
    {
      id: uid('tpl'),
      bookId,
      name: '早餐',
      type: 'expense' as TxType,
      amount: 1200,
      categoryId: 'cat_food_2',
      accountId: alipay?.id ?? accounts[0].id,
      projectId: null,
      merchant: '食堂',
      note: '',
      sort: 0,
    },
    {
      id: uid('tpl'),
      bookId,
      name: '地铁通勤',
      type: 'expense' as TxType,
      amount: 600,
      categoryId: 'cat_traffic_1',
      accountId: alipay?.id ?? accounts[0].id,
      projectId: null,
      merchant: '地铁',
      note: '',
      sort: 1,
    },
  ];

  return {
    ...base,
    projects: [...base.projects, ...projects],
    txs: [...txs, ...base.txs],
    budgets: [...base.budgets, ...budgets],
    templates: [...base.templates, ...templates],
    settings: { ...base.settings, lastBookId: bookId },
  };
}

export function demoNow(): string {
  return nowStr();
}
