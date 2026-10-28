import type { AccountType, LedgerData, Tx } from '@/types';
import {
  accountBalance,
  analyzeBudget,
  bookTransactions,
  buildCategoryMap,
  getBook,
  groupByDimension,
  summarize,
  totalAssets,
} from '@/store/selectors';
import { monthKey, todayStr } from '@/utils/date';
import { fenToYuan } from '@/utils/money';
import type { XlsxCell, XlsxSheet } from './xlsx';

const TYPE_LABEL: Record<Tx['type'], string> = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
  balance: '余额调整',
};

const ACCOUNT_LABEL: Record<AccountType, string> = {
  cash: '现金',
  debit: '储蓄卡',
  credit: '信用卡',
  alipay: '支付宝',
  wechat: '微信钱包',
  invest: '资产账户',
  other: '其他',
};

export interface BookWorkbook {
  sheets: XlsxSheet[];
  /** 该账本流水行数，供验收对账 */
  txRows: number;
  bookName: string;
  /** 流水超过上限被截断时为 true，调用方可据此提示 */
  truncated: boolean;
}

/** 单表行数上限。Excel 本身能到 104 万行，这里限的是主线程拼接耗时。 */
const MAX_TX_ROWS = 50000;

function stampText(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

/**
 * 把一个账本导出成五张工作表。
 *
 * 口径说明：金额一律换算成「元」写数值单元格（不写 t 属性），这样在 Excel
 * 里能直接求和——这是「集合成一个 Excel」相对 CSV 的核心价值。日期保留
 * ISO 文本，不碰 1900 纪元序列号，排序仍然正确。
 */
export function buildBookWorkbook(
  data: LedgerData,
  bookId: string,
  now: Date = new Date(),
  options: { maxTxRows?: number } = {},
): BookWorkbook {
  const limit = options.maxTxRows ?? MAX_TX_ROWS;
  const book = getBook(data, bookId);
  const bookName = book?.name ?? '账本';
  const allTxs = book ? bookTransactions(data, book.id) : [];
  const txs = allTxs.slice(0, limit);
  const truncated = allTxs.length > txs.length;

  const { byId, rootOf } = buildCategoryMap(data.categories);
  const accountName = (id: string | null) => data.accounts.find((a) => a.id === id)?.name ?? '';
  const projectName = (id: string | null) => data.projects.find((p) => p.id === id)?.name ?? '';

  /* ---------------------------------------------------------------- 概览 */

  const totals = summarize(txs);
  const accounts = data.accounts.filter((a) => a.bookId === bookId);
  const assets = totalAssets(accounts, txs);
  const range = txs.length
    ? `${txs[txs.length - 1].occurredAt.slice(0, 10)} 至 ${txs[0].occurredAt.slice(0, 10)}`
    : '暂无流水';

  const overviewRows: XlsxCell[][] = [
    ['项目', '值'],
    ['账本名称', bookName],
    ['统计区间', range],
    ['流水笔数', txs.length],
    ['总收入', fenToYuan(totals.income)],
    ['总支出', fenToYuan(totals.expense)],
    ['结余', fenToYuan(totals.net)],
    ['账户净资产', fenToYuan(assets.net)],
    ['账户数', accounts.length],
    ['分类数', data.categories.filter((c) => c.bookId === bookId || c.bookId === null).length],
    ['货币符号', data.settings.currency],
    ['生成时间', stampText(now)],
    ['数据版本', data.version],
  ];
  if (truncated) {
    overviewRows.push(['注意', `流水超过 ${limit} 条，本文件仅保留最近 ${limit} 条`]);
  }

  // 概览是键值排版，金额列与数字列混在同一列，套千分位格式会让「账户数」也
  // 变成 3.00。这里保持纯数值展示，精确求和交给「流水」表——它才是数据表。
  const overview: XlsxSheet = {
    name: '概览',
    rows: overviewRows,
    colWidths: [16, 30],
    headerRow: true,
  };

  /* ---------------------------------------------------------------- 流水 */

  const txRows: XlsxCell[][] = [
    ['时间', '类型', '一级分类', '二级分类', '金额', '账户', '转入账户', '项目', '商家', '备注'],
  ];
  for (const tx of txs) {
    const root = rootOf(tx.categoryId);
    const leaf = tx.categoryId ? byId.get(tx.categoryId) : undefined;
    const isLeafOfRoot = leaf && root && leaf.id !== root.id;
    txRows.push([
      tx.occurredAt.replace('T', ' '),
      TYPE_LABEL[tx.type] ?? tx.type,
      root?.name ?? '',
      isLeafOfRoot ? leaf?.name ?? '' : '',
      fenToYuan(tx.amount),
      accountName(tx.accountId),
      tx.type === 'transfer' ? accountName(tx.toAccountId) : '',
      projectName(tx.projectId),
      tx.merchant,
      tx.note,
    ]);
  }

  const flow: XlsxSheet = {
    name: '流水',
    rows: txRows,
    colWidths: [17, 10, 14, 14, 13, 14, 14, 12, 16, 28],
    headerRow: true,
    moneyCols: [4],
  };

  /* ------------------------------------------------------------ 分类汇总 */

  const expenseTxs = txs.filter((tx) => tx.type === 'expense');
  const groups = groupByDimension(expenseTxs, 'category', data, 50);
  const summaryRows: XlsxCell[][] = [['一级分类', '笔数', '金额', '占比'], ...groups.map((item) => [item.name, item.count, fenToYuan(item.amount), Number(item.percent.toFixed(2))])];
  summaryRows.push(['合计', expenseTxs.length, fenToYuan(summarize(expenseTxs).expense), 100]);

  const summary: XlsxSheet = {
    name: '分类汇总',
    rows: summaryRows,
    colWidths: [18, 10, 14, 10],
    headerRow: true,
    moneyCols: [2],
  };

  /* ---------------------------------------------------------------- 账户 */

  const accountRows: XlsxCell[][] = [['账户名称', '类型', '初始余额', '当前余额', '计入总资产']];
  for (const account of accounts) {
    accountRows.push([
      account.archived ? `${account.name}（已停用）` : account.name,
      ACCOUNT_LABEL[account.type] ?? account.type,
      fenToYuan(account.initialBalance),
      fenToYuan(accountBalance(account, txs)),
      account.includeInTotal ? '是' : '否',
    ]);
  }

  const accountSheet: XlsxSheet = {
    name: '账户',
    rows: accountRows,
    colWidths: [18, 12, 14, 14, 12],
    headerRow: true,
    moneyCols: [2, 3],
  };

  /* ---------------------------------------------------------------- 预算 */

  const currentMonth = monthKey(todayStr());
  const monthTxs = txs.filter((tx) => tx.occurredAt.slice(0, 7) === currentMonth);
  const budgetStatus = analyzeBudget(data, bookId, monthTxs, currentMonth);
  const budgetRows: XlsxCell[][] = [['月份', '分类', '预算额', '已用', '剩余', '使用率%']];
  if (book) {
    budgetRows.push([
      currentMonth,
      '总预算',
      fenToYuan(budgetStatus.totalBudget),
      fenToYuan(budgetStatus.totalSpent),
      fenToYuan(budgetStatus.totalBudget - budgetStatus.totalSpent),
      Number(budgetStatus.usage.toFixed(2)),
    ]);
    for (const row of budgetStatus.categoryRows) {
      budgetRows.push([
        currentMonth,
        row.categoryName,
        fenToYuan(row.budget),
        fenToYuan(row.spent),
        fenToYuan(row.budget - row.spent),
        Number(row.usage.toFixed(2)),
      ]);
    }
  }
  if (budgetRows.length === 1) budgetRows.push([currentMonth, '未设置预算', '', '', '', '']);

  const budgetSheet: XlsxSheet = {
    name: '预算',
    rows: budgetRows,
    colWidths: [12, 18, 14, 14, 14, 10],
    headerRow: true,
    moneyCols: [2, 3, 4],
  };

  return {
    sheets: [overview, flow, summary, accountSheet, budgetSheet],
    txRows: txs.length,
    bookName,
    truncated,
  };
}
