/**
 * 流水页验收：筛选、搜索、时间轴分组、行点击进详情。
 *
 * 前提：cli.bat auto --project . --auto-port 9420 已运行，且已执行过 taro build。
 *
 * 做法说明：先把默认账本的流水重置成 4 条固定记录再断言。
 * 不这么做的话，条数依赖模拟器里残留的历史数据，跑几次就对不上了
 * （记账闭环脚本已经因为「取最新一条」踩过同类坑）。
 * 重置只影响开发者工具内的模拟数据，不碰任何真实数据。
 *
 * 验收点：
 * 1. 底栏点「流水」能进流水页
 * 2. 头部标题与「N 笔记录」和实际数据一致
 * 3. 时间轴按月/日分组渲染，行数 = 筛选后条数
 * 4. 类型筛选、月份筛选、关键词搜索各自生效
 * 5. 筛选合计的三个数字与页面上的筛选结果自洽
 * 6. 搜不到时出现空状态与「清除筛选条件」，点了能恢复
 * 7. 点流水行进编辑态、点右上角加号进记账页
 */
const automator = require('miniprogram-automator');
const path = require('path');
const fs = require('fs');

const PORT = process.env.AUTO_PORT || '9420';
const outDir = path.join(__dirname, '..', 'preview');
fs.mkdirSync(outDir, { recursive: true });

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 轮询页面栈顶，避免固定 sleep 在不同机器上不够用 */
async function waitForPage(mp, keyword, timeout = 12000) {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    const pages = await mp.pageStack();
    last = pages.length ? pages[pages.length - 1].path : '';
    if (last.includes(keyword)) {
      await sleep(400);
      return await mp.currentPage();
    }
    await sleep(200);
  }
  console.log(`   [warn] 等待 ${keyword} 超时，当前 ${last}`);
  return await mp.currentPage();
}

async function tapText(page, selector, text) {
  const els = await page.$$(selector);
  for (const el of els) {
    const t = (await el.text()).trim();
    if (t === text) {
      await el.tap();
      return true;
    }
  }
  return false;
}

/** 读页面上能看到的流水行数（只算 DOM，验证渲染而不是内存） */
const domRowCount = async (page) => (await page.$$('.tx-row')).length;

/** 读时间轴上的月份标题，已出现「2026年9月」这种 */
const domMonths = async (page) => {
  const els = await page.$$('.timeline__month');
  const out = [];
  for (const el of els) out.push((await el.text()).trim());
  return out;
};

(async () => {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('已连接自动化端口\n');

  // ---------- 0. 重置为确定的 4 条记录 ----------
  await mp.reLaunch('/pages/home/index');
  await sleep(1500);

  const seedInfo = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const book = s.data.books[0];

    // 清空该账本已有流水（走真实 action，保证落盘）
    for (const tx of s.data.txs.filter((t) => t.bookId === book.id)) {
      s.deleteTx(tx.id);
    }

    const now = globalThis.__ledgerStore.getState();
    const acc = now.data.accounts.filter((a) => a.bookId === book.id && !a.archived)[0];
    const expCat = now.data.categories.filter((c) => c.type === 'expense' && !c.archived)[0];
    const incCat = now.data.categories.filter((c) => c.type === 'income' && !c.archived)[0];

    const pad = (n) => String(n).padStart(2, '0');
    const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());

    const base = {
      bookId: book.id,
      accountId: acc ? acc.id : null,
      toAccountId: null,
      projectId: null,
      merchant: '',
    };

    const seed = [
      { ...base, type: 'expense', amount: 1250, note: '午餐', occurredAt: `${stamp(today)}T10:00`, categoryId: expCat ? expCat.id : null },
      { ...base, type: 'income', amount: 10000, note: '稿费', occurredAt: `${stamp(today)}T15:30`, categoryId: incCat ? incCat.id : null },
      { ...base, type: 'expense', amount: 800, note: '早餐', occurredAt: `${stamp(yesterday)}T08:00`, categoryId: expCat ? expCat.id : null },
      { ...base, type: 'expense', amount: 3000, note: '上月打车', occurredAt: `${stamp(lastMonth)}T09:00`, categoryId: expCat ? expCat.id : null },
    ];
    for (const item of seed) globalThis.__ledgerStore.getState().addTx(item);

    const cur = globalThis.__ledgerStore.getState().data;
    return {
      bookName: book.name,
      count: cur.txs.filter((t) => t.bookId === book.id).length,
      todayLabel: `${today.getFullYear()}年${today.getMonth() + 1}月`,
      lastMonthLabel: `${lastMonth.getFullYear()}年${lastMonth.getMonth() + 1}月`,
    };
  });
  console.log(
    `已播种：账本「${seedInfo.bookName}」，${seedInfo.count} 条；今天属 ${seedInfo.todayLabel}，上月属 ${seedInfo.lastMonthLabel}\n`,
  );
  check('播种 4 条固定流水', seedInfo.count === 4, `${seedInfo.count} 条`);

  // ---------- 1. 从底栏进流水页 ----------
  await mp.reLaunch('/pages/home/index');
  await sleep(1500);
  let page = await mp.currentPage();
  const entered = await tapText(page, '.tabbar__item', '流水');
  check('底栏有「流水」入口', entered);
  page = await waitForPage(mp, 'pages/ledger/index');
  check('进入流水页', page.path.includes('pages/ledger/index'), page.path);

  // ---------- 2. 头部 ----------
  const titleEl = await page.$('.ledger-head__title');
  const subEl = await page.$('.ledger-head__sub');
  const title = titleEl ? (await titleEl.text()).trim() : '';
  const sub = subEl ? (await subEl.text()).trim() : '';
  check('标题为「流水」', title === '流水', title);
  check('副标题为 4 笔记录', sub === '4 笔记录', sub);

  // ---------- 3. 时间轴分组 ----------
  let rows = await domRowCount(page);
  check('全部条件下渲染 4 行', rows === 4, `${rows} 行`);

  let months = await domMonths(page);
  check(
    '时间轴按月份分组',
    months.length === 2,
    months.join(' | '),
  );
  check(
    '本月与上月标题都在',
    months.includes(seedInfo.todayLabel) && months.includes(seedInfo.lastMonthLabel),
    months.join(' | '),
  );

  // ---------- 4. 类型筛选 ----------
  const tappedExpense = await tapText(page, '.chip', '支出');
  await sleep(800);
  check('点「支出」筛选', tappedExpense);
  rows = await domRowCount(page);
  check('支出筛选后剩 3 行', rows === 3, `${rows} 行`);

  await tapText(page, '.chip', '收入');
  await sleep(800);
  rows = await domRowCount(page);
  check('收入筛选后剩 1 行', rows === 1, `${rows} 行`);

  await tapText(page, '.chip', '全部');
  await sleep(800);
  rows = await domRowCount(page);
  check('切回全部恢复 4 行', rows === 4, `${rows} 行`);

  // ---------- 5. 月份筛选 ----------
  await tapText(page, '.segmented__item', '上月');
  await sleep(800);
  rows = await domRowCount(page);
  months = await domMonths(page);
  check('「上月」只剩 1 行', rows === 1, `${rows} 行`);
  check(
    '「上月」只剩上个月分组',
    months.length === 1 && months[0] === seedInfo.lastMonthLabel,
    months.join(' | '),
  );

  await tapText(page, '.segmented__item', '全部');
  await sleep(800);
  rows = await domRowCount(page);
  check('月份切回全部恢复 4 行', rows === 4, `${rows} 行`);

  // ---------- 6. 搜索 ----------
  const input = await page.$('.search-bar__input');
  check('搜索框存在', Boolean(input));
  if (input) {
    await input.input('午餐');
    await sleep(900);
    rows = await domRowCount(page);
    check('搜「午餐」剩 1 行', rows === 1, `${rows} 行`);

    const subEl2 = await page.$('.ledger-head__sub');
    const sub2 = subEl2 ? (await subEl2.text()).trim() : '';
    check('副标题跟随筛选变化', sub2 === '1 笔记录', sub2);

    await input.input('zzz不存在');
    await sleep(900);
    rows = await domRowCount(page);
    const emptyTitle = await page.$('.empty__title');
    const emptyText = emptyTitle ? (await emptyTitle.text()).trim() : '';
    check('搜不到时无流水行', rows === 0, `${rows} 行`);
    check('出现空状态提示', emptyText === '没有找到流水', emptyText);

    // ---------- 7. 清除筛选 ----------
    const cleared = await tapText(page, '.btn', '清除筛选条件');
    await sleep(800);
    rows = await domRowCount(page);
    check('点「清除筛选条件」可恢复', cleared && rows === 4, `cleared=${cleared}，${rows} 行`);
  }

  // ---------- 8. 筛选合计自洽 ----------
  const totals = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const book = s.data.books[0];
    const txs = s.data.txs.filter((t) => t.bookId === book.id);
    const exp = txs.filter((t) => t.type === 'expense').reduce((a, b) => a + b.amount, 0);
    const inc = txs.filter((t) => t.type === 'income').reduce((a, b) => a + b.amount, 0);
    return { exp, inc, net: inc - exp };
  });
  const totalEls = await page.$$('.ledger-totals__num');
  const netEl = await page.$('.ledger-totals__net');
  const shownExp = totalEls.length ? (await totalEls[0].text()).trim() : '';
  const shownInc = totalEls.length > 1 ? (await totalEls[1].text()).trim() : '';
  const shownNet = netEl ? (await netEl.text()).trim() : '';
  const yuan = (fen) => `${Math.floor(Math.abs(fen) / 100)}.${String(Math.abs(fen) % 100).padStart(2, '0')}`;
  check('合计·支出来自真实数据', shownExp === `支 ${yuan(totals.exp)}`, `页面 ${shownExp} / 期望 支 ${yuan(totals.exp)}`);
  check('合计·收入来自真实数据', shownInc === `收 ${yuan(totals.inc)}`, `页面 ${shownInc} / 期望 收 ${yuan(totals.inc)}`);
  check('合计·结余结余正确', shownNet === `结余 ${totals.net < 0 ? '-' : ''}${yuan(totals.net)}`, `页面 ${shownNet}`);

  // ---------- 9. 点行进编辑态 ----------
  const firstRow = await page.$('.tx-row');
  check('页面有可点击流水行', Boolean(firstRow));
  if (firstRow) {
    await firstRow.tap();
    page = await waitForPage(mp, 'pages/record/index');
    check('点流水行进记账页', page.path.includes('pages/record/index'), page.path);
    const headTitle = await page.$('.record__title');
    const ht = headTitle ? (await headTitle.text()).trim() : '';
    check('进入的是编辑态', ht === '编辑记录', ht);
  }

  // ---------- 10. 右上角加号 ----------
  await mp.reLaunch('/pages/ledger/index');
  await sleep(1500);
  page = await mp.currentPage();
  const plus = await page.$('.ledger-head .icon-btn');
  check('顶部有加号按钮', Boolean(plus));
  if (plus) {
    await plus.tap();
    page = await waitForPage(mp, 'pages/record/index');
    check('点加号进记账页', page.path.includes('pages/record/index'), page.path);
    const headTitle = await page.$('.record__title');
    const ht = headTitle ? (await headTitle.text()).trim() : '';
    check('新增态标题为「记一笔」', ht === '记一笔', ht);
  }

  // ---------- 截图 ----------
  await mp.reLaunch('/pages/ledger/index');
  await sleep(1500);
  try {
    const shot = path.join(outDir, 'ledger-page.png');
    await mp.screenshot({ path: shot });
    console.log(`\n截图: ${shot}`);
  } catch (e) {
    console.log('截图失败（不影响结论）:', e.message);
  }

  await mp.disconnect();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('失败:', err && err.message ? err.message : err);
  process.exit(1);
});
