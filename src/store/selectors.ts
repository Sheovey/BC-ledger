import type {
  Account,
  Category,
  DateRange,
  LedgerData,
  Project,
  Settings,
  StatDimension,
  Tx,
} from '@/types';
import { sumFen } from '@/utils/money';
import { resolveRange, withinRange } from '@/utils/date';

export interface StatItem {
  key: string;
  name: string;
  color: string;
  icon?: string;
  amount: number;
  count: number;
  percent: number;
  /** 仅 key='__rest__' 时有值：被合并进来的真实分组 key，用于反查明细 */
  restKeys?: string[];
}

export function getBook(data: LedgerData, bookId?: string | null) {
  const target = bookId ?? data.settings.lastBookId;
  return data.books.find((b) => b.id === target) ?? data.books.find((b) => !b.archived) ?? data.books[0];
}

export function visibleBooks(data: LedgerData) {
  return [...data.books].sort((a, b) => a.sort - b.sort);
}

/** 分类查询表：id → 一级分类（二级自动上卷到父级） */
export function buildCategoryMap(categories: Category[]) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const rootOf = (id: string | null): Category | undefined => {
    if (!id) return undefined;
    const category = byId.get(id);
    if (!category) return undefined;
    return category.parentId ? byId.get(category.parentId) : category;
  };
  return { byId, rootOf };
}

export function categoryLabel(byId: Map<string, Category>, id: string | null): string {
  if (!id) return '未分类';
  const category = byId.get(id);
  if (!category) return '已删除分类';
  if (!category.parentId) return category.name;
  const parent = byId.get(category.parentId);
  return parent ? `${parent.name} / ${category.name}` : category.name;
}

/** 流水排序比较器：时间倒序；同一时刻按创建时间倒序，避免同秒记录顺序不稳。 */
export function compareTxDesc(a: Tx, b: Tx): number {
  return b.occurredAt.localeCompare(a.occurredAt) || b.createdAt.localeCompare(a.createdAt);
}

/**
 * 时间倒序排序，返回新数组、不改入参。
 * 分页切片前必须先调用：store 里新增流水是往数组头部插的，
 * 原始顺序既不保证按时间，也不保证稳定，直接 slice 会出现重复或漏项。
 */
export function sortTxsDesc(txs: readonly Tx[]): Tx[] {
  return [...txs].sort(compareTxDesc);
}

export function bookTransactions(data: LedgerData, bookId: string): Tx[] {
  return sortTxsDesc(data.txs.filter((tx) => tx.bookId === bookId));
}

export function rangeTransactions(txs: Tx[], range: DateRange): Tx[] {
  return txs.filter((tx) => withinRange(tx.occurredAt, range));
}

export interface Totals {
  income: number;
  expense: number;
  net: number;
  count: number;
}

/** 收支合计：转账与余额调整不计入收支口径 */
export function summarize(txs: Tx[]): Totals {
  const income = sumFen(txs.filter((tx) => tx.type === 'income').map((tx) => tx.amount));
  const expense = sumFen(txs.filter((tx) => tx.type === 'expense').map((tx) => tx.amount));
  return { income, expense, net: income - expense, count: txs.length };
}

export function accountBalance(account: Account, txs: Tx[]): number {
  let balance = account.initialBalance;
  for (const tx of txs) {
    if (tx.type === 'income' && tx.accountId === account.id) balance += tx.amount;
    else if (tx.type === 'expense' && tx.accountId === account.id) balance -= tx.amount;
    else if (tx.type === 'transfer') {
      if (tx.accountId === account.id) balance -= tx.amount;
      if (tx.toAccountId === account.id) balance += tx.amount;
    } else if (tx.type === 'balance' && tx.accountId === account.id) balance += tx.amount;
  }
  return balance;
}

export function totalAssets(accounts: Account[], txs: Tx[]): { assets: number; liabilities: number; net: number } {
  let assets = 0;
  let liabilities = 0;
  for (const account of accounts) {
    if (account.archived || !account.includeInTotal) continue;
    const balance = accountBalance(account, txs);
    if (balance >= 0) assets += balance;
    else liabilities += -balance;
  }
  return { assets, liabilities, net: assets - liabilities };
}

/** 维度聚合需要的查询表，一次建好供多次取 key 使用 */
export interface DimensionMaps {
  rootOf: (id: string | null) => Category | undefined;
  accounts: Map<string, Account>;
  projects: Map<string, Project>;
}

export function buildDimensionMaps(data: LedgerData): DimensionMaps {
  const { rootOf } = buildCategoryMap(data.categories);
  return {
    rootOf,
    accounts: new Map(data.accounts.map((a) => [a.id, a])),
    projects: new Map(data.projects.map((p) => [p.id, p])),
  };
}

export interface DimensionBucket {
  key: string;
  name: string;
  color: string;
  icon?: string;
}

/**
 * 一条流水属于哪个分组。聚合与「取某组明细」共用这一个函数，
 * 两处必须完全一致，否则点开分组看到的条目会对不上汇总数字。
 */
export function dimensionKeyOf(
  tx: Tx,
  dimension: StatDimension,
  maps: DimensionMaps,
): DimensionBucket {
  if (dimension === 'category') {
    const root = maps.rootOf(tx.categoryId);
    return {
      key: root?.id ?? 'none',
      name: root?.name ?? '未分类',
      color: root?.color ?? '#c3c7d1',
      icon: root?.icon,
    };
  }
  if (dimension === 'account') {
    const account = tx.accountId ? maps.accounts.get(tx.accountId) : undefined;
    return {
      key: account?.id ?? 'none',
      name: account?.name ?? '未指定账户',
      color: account?.color ?? '#c3c7d1',
      icon: account?.icon,
    };
  }
  if (dimension === 'project') {
    const project = tx.projectId ? maps.projects.get(tx.projectId) : undefined;
    return {
      key: project?.id ?? 'none',
      name: project?.name ?? '未归项目',
      color: project?.color ?? '#c3c7d1',
      icon: 'project',
    };
  }
  const merchant = tx.merchant?.trim();
  return {
    key: merchant || 'none',
    name: merchant || '未填商家',
    color: '#b0b7c3',
    icon: 'merchant',
  };
}

/**
 * 取某个分组下的流水明细。
 * - 保序不排序：调用方应保证 txs 已按时间倒序。
 * - key 为 `__rest__` 时必须传 restKeys（由 groupByDimension 给出），
 *   它对应多个真实分组，单靠 key 筛不出来。
 */
export function txsOfGroup(
  txs: Tx[],
  dimension: StatDimension,
  data: LedgerData,
  key: string,
  restKeys?: readonly string[],
): Tx[] {
  const maps = buildDimensionMaps(data);
  if (key === '__rest__') {
    if (!restKeys || !restKeys.length) return [];
    const allowed = new Set(restKeys);
    return txs.filter((tx) => allowed.has(dimensionKeyOf(tx, dimension, maps).key));
  }
  return txs.filter((tx) => dimensionKeyOf(tx, dimension, maps).key === key);
}

/** 按维度聚合，降序，超出 limit 的合并为「其他」 */
export function groupByDimension(
  txs: Tx[],
  dimension: StatDimension,
  data: LedgerData,
  limit = 12,
): StatItem[] {
  const maps = buildDimensionMaps(data);
  const buckets = new Map<
    string,
    { name: string; color: string; icon?: string; amount: number; count: number }
  >();

  for (const tx of txs) {
    const bucketKey = dimensionKeyOf(tx, dimension, maps);
    const bucket = buckets.get(bucketKey.key) ?? {
      name: bucketKey.name,
      color: bucketKey.color,
      icon: bucketKey.icon,
      amount: 0,
      count: 0,
    };
    bucket.amount += tx.amount;
    bucket.count += 1;
    buckets.set(bucketKey.key, bucket);
  }

  const total = sumFen([...buckets.values()].map((b) => b.amount));
  const list: StatItem[] = [...buckets.entries()]
    .map(([key, bucket]) => ({
      key,
      name: bucket.name,
      color: bucket.color,
      icon: bucket.icon,
      amount: bucket.amount,
      count: bucket.count,
      percent: total ? (bucket.amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  if (list.length <= limit) return list;
  const head = list.slice(0, limit - 1);
  const tail = list.slice(limit - 1);
  const tailAmount = sumFen(tail.map((i) => i.amount));
  const tailCount = tail.reduce((acc, i) => acc + i.count, 0);
  head.push({
    key: '__rest__',
    name: `其他 ${tail.length} 项`,
    color: '#d5d9e0',
    amount: tailAmount,
    count: tailCount,
    percent: total ? (tailAmount / total) * 100 : 0,
    // 记住被合并的真实分组，否则「其他 N 项」点开是空的
    restKeys: tail.map((i) => i.key),
  });
  return head;
}

export interface BudgetStatus {
  totalBudget: number;
  totalSpent: number;
  over: number;
  usage: number;
  categoryRows: Array<{
    budget: number;
    spent: number;
    over: number;
    usage: number;
    categoryName: string;
    color: string;
    id: string;
  }>;
}

/** 预算只统计支出；月度预算优先取单月，其次取通用预算 */
export function analyzeBudget(
  data: LedgerData,
  bookId: string,
  txs: Tx[],
  monthKey: string,
): BudgetStatus {
  const { byId, rootOf } = buildCategoryMap(data.categories);
  const budgets = data.budgets.filter((b) => b.bookId === bookId);
  const resolve = (categoryId: string | null) =>
    budgets.find((b) => b.categoryId === categoryId && b.month === monthKey) ??
    budgets.find((b) => b.categoryId === categoryId && b.month === '*');

  const totalBudget = resolve(null)?.amount ?? 0;
  const expenses = txs.filter((tx) => tx.type === 'expense');
  const totalSpent = sumFen(expenses.map((tx) => tx.amount));

  const categoryRows = budgets
    .filter((b) => b.categoryId && (b.month === monthKey || b.month === '*'))
    .filter((b, index, arr) => arr.findIndex((x) => x.categoryId === b.categoryId) === index)
    .map((b) => {
      const category = b.categoryId ? byId.get(b.categoryId) : undefined;
      const spent = sumFen(
        expenses.filter((tx) => rootOf(tx.categoryId)?.id === b.categoryId || tx.categoryId === b.categoryId).map((tx) => tx.amount),
      );
      return {
        id: b.categoryId as string,
        budget: b.amount,
        spent,
        over: spent - b.amount,
        usage: b.amount ? (spent / b.amount) * 100 : 0,
        categoryName: category?.name ?? '未知分类',
        color: category?.color ?? '#c3c7d1',
      };
    })
    .sort((a, b) => b.spent - a.spent);

  return {
    totalBudget,
    totalSpent,
    over: totalSpent - totalBudget,
    usage: totalBudget ? (totalSpent / totalBudget) * 100 : 0,
    categoryRows,
  };
}

/** 最近 N 个月的收支序列，用于趋势条形图 */
export function monthlySeries(
  txs: Tx[],
  months: number,
  settings: Settings,
): Array<{ label: string; month: string; income: number; expense: number }> {
  const out: Array<{ label: string; month: string; income: number; expense: number }> = [];
  const base = new Date();
  for (let i = months - 1; i >= 0; i -= 1) {
    const anchorDate = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const anchor = `${anchorDate.getFullYear()}-${String(anchorDate.getMonth() + 1).padStart(2, '0')}-01`;
    const range = resolveRange('month', anchor, settings.monthStartDay);
    const items = rangeTransactions(txs, range);
    out.push({
      label: `${anchorDate.getMonth() + 1}月`,
      month: anchor.slice(0, 7),
      income: sumFen(items.filter((t) => t.type === 'income').map((t) => t.amount)),
      expense: sumFen(items.filter((t) => t.type === 'expense').map((t) => t.amount)),
    });
  }
  return out;
}

/** 活跃分类选项（一级含二级），供记账页与筛选器使用 */
export function categoryTree(categories: Category[], type: 'expense' | 'income') {
  const roots = categories
    .filter((c) => !c.archived && !c.parentId && c.type === type)
    .sort((a, b) => a.sort - b.sort);
  return roots.map((root) => ({
    ...root,
    children: categories
      .filter((c) => !c.archived && c.parentId === root.id)
      .sort((a, b) => a.sort - b.sort),
  }));
}

/** 搜索：备注、商家、分类名、金额均可命中 */
export function searchTransactions(txs: Tx[], keyword: string, categories: Category[]): Tx[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return txs;
  const { byId } = buildCategoryMap(categories);
  return txs.filter((tx) => {
    const categoryName = tx.categoryId ? byId.get(tx.categoryId)?.name ?? '' : '';
    const parentName = tx.categoryId ? byId.get(byId.get(tx.categoryId)?.parentId ?? '')?.name ?? '' : '';
    const amountText = (tx.amount / 100).toFixed(2);
    return [tx.note, tx.merchant, categoryName, parentName, amountText].some((field) =>
      (field ?? '').toLowerCase().includes(kw),
    );
  });
}
