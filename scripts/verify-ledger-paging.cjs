/**
 * 流水页分页加载 + 月份区间筛选验收。
 *
 * 前提：cli.bat auto --project . --auto-port 9420 已运行，且已执行过 taro build。
 *
 * 为什么单独一个脚本：verify-ledger.cjs 只播 4 条，永远测不到「每次 30 条」。
 * 这里刻意播 65 条，并且按 30 / 20 / 10 / 5 分布在四天，
 * 让每次分页边界都正好落在某一天的最后一条 —— 这样「整天切边」不会额外补条，
 * 断言可以写成精确值，而不是「大约 30 条」。
 *
 * 验收点：
 * 1. 首屏只渲染 30 条，但副标题与筛选合计按 65 条全量算
 * 2. 触底后追加到 60、再追加到 65，终态显示「已显示全部」
 * 3. 第一个日组的合计是当天全部流水（验证整天切边，不会出现半天合计）
 * 4. 月份标题不重复（分页不会重开月份组）
 * 5. 切换类型筛选后分页游标重置
 * 6. 「区间」弹层能打开、能确认，标签变为短格式且筛选生效
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

const domRowCount = async (page) => (await page.$$('.tx-row')).length;

(async () => {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('已连接自动化端口\n');

  // ---------- 0. 播 65 条，按天分布 30 / 20 / 10 / 5 ----------
  const seed = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const book = s.data.books[0];
    for (const tx of s.data.txs.filter((t) => t.bookId === book.id)) s.deleteTx(tx.id);

    const now = globalThis.__ledgerStore.getState();
    const acc = now.data.accounts.filter((a) => a.bookId === book.id && !a.archived)[0];
    const roots = now.data.categories.filter(
      (c) => c.type === 'expense' && !c.archived && !c.parentId,
    );
    const cat = roots[0];
    const pad = (n) => String(n).padStart(2, '0');
    const base = new Date();
    const dayOf = (offset) => {
      const x = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
      return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
    };
    const lastMonthDay = (() => {
      const x = new Date(base.getFullYear(), base.getMonth() - 1, 15);
      return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-15`;
    })();

    const plan = [
      { date: dayOf(0), count: 30 },
      { date: dayOf(-1), count: 20 },
      { date: dayOf(-2), count: 10 },
      { date: lastMonthDay, count: 5 },
    ];
    const unit = 100;

    let serial = 0;
    for (const item of plan) {
      for (let i = 0; i < item.count; i += 1) {
        serial += 1;
        globalThis.__ledgerStore.getState().addTx({
          bookId: book.id,
          type: 'expense',
          amount: unit,
          categoryId: cat ? cat.id : null,
          accountId: acc ? acc.id : null,
          toAccountId: null,
          projectId: null,
          merchant: '',
          note: `分页${serial}`,
          occurredAt: `${item.date}T09:${pad(i)}`,
        });
      }
    }

    return {
      total: serial,
      firstDayCount: plan[0].count,
      firstDayExpense: plan[0].count * unit,
      allExpense: serial * unit,
      categoryName: cat ? cat.name : '未分类',
    };
  });
  console.log(
    `已播种 ${seed.total} 条（首日 ${seed.firstDayCount} 条，合计 ${seed.allExpense} 分）\n`,
  );
  check('播种 65 条流水', seed.total === 65, `${seed.total} 条`);

  // ---------- 1. 进流水页 ----------
  await mp.reLaunch('/pages/home/index');
  await sleep(1500);
  let page = await mp.currentPage();
  const entered = await tapText(page, '.tabbar__item', '流水');
  check('底栏有「流水」入口', entered);
  page = await waitForPage(mp, 'pages/ledger/index');
  check('进入流水页', page.path.includes('pages/ledger/index'), page.path);

  const subEl = await page.$('.ledger-head__sub');
  const sub = subEl ? (await subEl.text()).trim() : '';
  check('副标题按全量显示 65 笔', sub === '65 笔记录', sub);

  // ---------- 2. 首屏只渲染 30 条 ----------
  let rows = await domRowCount(page);
  check('首屏渲染 30 条', rows === 30, `${rows} 条`);

  // 整天切边：第一个日组的合计必须是当天全部 30 条，而不是「首屏里的那几条」
  const firstDaySum = await page.$('.day-group .day-head__sum');
  const firstDayText = firstDaySum ? (await firstDaySum.text()).replace(/\s/g, '') : '';
  const expectDay = `支${(seed.firstDayExpense / 100).toFixed(2)}`;
  check('第一个日组合计是当天全量', firstDayText.includes(expectDay), `${firstDayText} / 期望含 ${expectDay}`);

  const totalsEl = await page.$('.ledger-totals');
  const totalsText = totalsEl ? (await totalsEl.text()).replace(/\s/g, '') : '';
  const expectAll = `支${(seed.allExpense / 100).toFixed(2)}`;
  check('筛选合计按全量算', totalsText.includes(expectAll), `${totalsText} / 期望含 ${expectAll}`);

  const footEl = await page.$('.load-more');
  const footText = footEl ? (await footEl.text()).trim() : '';
  check('页脚提示还有 35 笔', footText.includes('还有 35 笔'), footText);

  // ---------- 3. 触底加载 ----------
  /**
   * 三层兜底：API 滚动不一定派发 onReachBottom，所以依次尝试
   * ①真滚动 ②直调页面生命周期 ③点页脚（产品本身的手动降级入口）。
   * 日志里打印走了哪条路，方便判断真机上哪种可靠。
   */
  const loadMore = async (before) => {
    await mp.evaluate(() => {
      try {
        wx.pageScrollTo({ scrollTop: 99999, duration: 0 });
      } catch (error) {
        /* 滚动失败继续走兜底 */
      }
    });
    await sleep(800);
    let count = await domRowCount(page);
    if (count !== before) return { count, via: 'scroll' };

    const called = await mp.evaluate(() => {
      const stack = getCurrentPages();
      const current = stack[stack.length - 1];
      if (!current || typeof current.onReachBottom !== 'function') return false;
      current.onReachBottom({});
      return true;
    });
    await sleep(800);
    count = await domRowCount(page);
    if (count !== before) return { count, via: called ? 'onReachBottom' : 'none' };

    const foot = await page.$('.load-more');
    if (foot) {
      await foot.tap();
      await sleep(800);
    }
    count = await domRowCount(page);
    return { count, via: 'tap' };
  };

  const second = await loadMore(30);
  console.log(`   [info] 第二次加载走的是 ${second.via}`);
  check('触底后加载到 60 条', second.count === 60, `${second.count} 条`);

  const third = await loadMore(60);
  console.log(`   [info] 第三次加载走的是 ${third.via}`);
  check('再次触底加载到 65 条', third.count === 65, `${third.count} 条`);

  const footEnd = await page.$('.load-more');
  const footEndText = footEnd ? (await footEnd.text()).trim() : '';
  check('终态显示已显示全部', footEndText === '已显示全部 65 笔', footEndText);

  const months = await page.$$('.timeline__month');
  const monthTexts = [];
  for (const m of months) monthTexts.push((await m.text()).trim());
  check('月份标题不重复', new Set(monthTexts).size === monthTexts.length, monthTexts.join(' / '));

  // ---------- 4. 切换筛选后分页游标重置 ----------
  await mp.evaluate(() => {
    try {
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    } catch (error) {
      /* 忽略 */
    }
  });
  await sleep(400);

  const tappedExpense = await tapText(page, '.chip', '支出');
  await sleep(700);
  rows = await domRowCount(page);
  check('切到「支出」后行数回到一页以内', tappedExpense && rows <= 30, `${rows} 条`);

  const tappedAll = await tapText(page, '.chip', '全部');
  await sleep(700);
  rows = await domRowCount(page);
  check('切回「全部」后仍从首屏开始', tappedAll && rows === 30, `${rows} 条`);

  // ---------- 5. 月份区间 ----------
  const openedRange = await tapText(page, '.segmented__item', '区间');
  await sleep(700);
  const sheetTitle = await page.$('.sheet__title');
  check('点「区间」打开选择弹层', openedRange && Boolean(sheetTitle), sheetTitle ? await sheetTitle.text() : '未找到');

  const spanEl = await page.$('.range-sheet__span');
  const spanText = spanEl ? (await spanEl.text()).trim() : '';
  check('弹层显示实际包含的日期', /实际包含\s*\d{4}-\d{2}-\d{2}/.test(spanText.replace(/\s/g, ' ')), spanText);

  const confirmed = await tapText(page, '.range-sheet__actions .btn', '确定');
  await sleep(800);
  const segItems = await page.$$('.segmented__item');
  const rangeLabel = segItems.length >= 4 ? (await segItems[3].text()).trim() : '';
  check('确认后区间项显示短格式标签', confirmed && /^\d{2}\.\d{2}-\d{2}\.\d{2}/.test(rangeLabel), rangeLabel);

  const subAfterRange = await page.$('.ledger-head__sub');
  const subRangeText = subAfterRange ? (await subAfterRange.text()).trim() : '';
  check('区间筛选后仍有数据', /\d+ 笔记录/.test(subRangeText), subRangeText);

  // 区间与「全部」互斥：点全部后第 4 项回到「区间」文案
  await tapText(page, '.segmented__item', '全部');
  await sleep(600);
  const segAfter = await page.$$('.segmented__item');
  const rangeLabelAfter = segAfter.length >= 4 ? (await segAfter[3].text()).trim() : '';
  check('切回「全部」后区间项恢复占位文案', rangeLabelAfter === '区间', rangeLabelAfter);

  // ---------- 6. 截图 ----------
  try {
    await mp.evaluate(() => {
      try {
        wx.pageScrollTo({ scrollTop: 99999, duration: 0 });
      } catch (error) {
        /* 忽略 */
      }
    });
    await sleep(500);
    const shot = path.join(outDir, 'ledger-paging.png');
    await mp.screenshot({ path: shot });
    console.log(`\n截图: ${shot}`);
  } catch (error) {
    console.log('截图失败（不影响结论）:', error.message);
  }

  // ---------- 汇总 ----------
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n合计 ${results.length} 项，通过 ${passed}，失败 ${failed}`);
  if (failed) {
    for (const r of results.filter((x) => !x.pass)) console.log(`  失败: ${r.label} — ${r.detail}`);
  }

  await mp.disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (error) => {
  console.error('\n脚本异常:', error && error.message ? error.message : error);
  process.exit(1);
});
