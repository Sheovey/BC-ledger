/**
 * 四页截图（改版后人眼复核用，不参与验收断言）。
 * 前提：cli.bat auto --project . --auto-port 9420 已运行。
 *
 * 用法：node scripts/shot-pages.cjs [ledger|range|stats|settings|home|all]
 */
const automator = require('miniprogram-automator');
const path = require('path');
const fs = require('fs');

const PORT = process.env.AUTO_PORT || '9420';
const outDir = path.join(__dirname, '..', 'preview');
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const target = process.argv[2] || 'all';
const want = (k) => target === 'all' || target === k;

(async () => {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('已连接\n');

  const shot = async (name) => {
    const p = path.join(outDir, `${name}.png`);
    await mp.screenshot({ path: p });
    console.log(`  → ${path.basename(p)} (${(fs.statSync(p).size / 1024).toFixed(1)} KB)`);
  };

  // 播一批像样的数据：本月多笔 + 上月几笔，覆盖多分类
  await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const book = s.data.books[0];
    for (const tx of s.data.txs.filter((t) => t.bookId === book.id)) s.deleteTx(tx.id);
    const now = globalThis.__ledgerStore.getState();
    const acc = now.data.accounts.filter((a) => a.bookId === book.id && !a.archived)[0];
    const roots = now.data.categories.filter((c) => c.type === 'expense' && !c.archived && !c.parentId);
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const today = new Date();
    const push = (daysAgo, amount, note, idx, hour) => {
      const d = new Date(today.getTime() - daysAgo * 86400000);
      const cat = roots[idx % roots.length];
      globalThis.__ledgerStore.getState().addTx({
        bookId: book.id,
        accountId: acc ? acc.id : null,
        toAccountId: null,
        projectId: null,
        categoryId: cat ? cat.id : null,
        merchant: '',
        type: 'expense',
        amount,
        note,
        occurredAt: `${stamp(d)}T${pad(hour || 12)}:00`,
      });
    };
    push(0, 2350, '午餐', 0, 12);
    push(0, 600, '咖啡', 1, 9);
    push(0, 12800, '超市采购', 2, 19);
    push(1, 3600, '打车', 3, 8);
    push(1, 8900, '晚餐', 0, 20);
    push(2, 4500, '地铁充值', 3, 7);
    push(2, 29900, '衣服', 4, 15);
    push(3, 1500, '早餐', 0, 8);
    push(3, 6800, '电影', 1, 21);
    push(5, 12000, '水电', 5, 10);
    push(8, 2400, '零食', 0, 16);
    push(35, 18000, '上月房租', 5, 9);
    push(36, 5200, '上月聚餐', 0, 19);
    push(38, 3300, '上月交通', 3, 8);
  });
  await sleep(900);

  if (want('home')) {
    await mp.reLaunch('/pages/home/index');
    await sleep(1200);
    console.log('首页');
    await shot('shot-home');
  }

  if (want('ledger')) {
    await mp.reLaunch('/pages/ledger/index');
    await sleep(1200);
    await mp.pageScrollTo(0, 0);
    await sleep(400);
    console.log('流水页顶部（看 4 段筛选是否溢出）');
    await shot('shot-ledger-top');
  }

  if (want('range')) {
    await mp.reLaunch('/pages/ledger/index');
    await sleep(1200);
    const page = await mp.currentPage();
    for (const el of await page.$$('.segmented__item')) {
      if ((await el.text()).trim() === '区间') {
        await el.tap();
        break;
      }
    }
    await sleep(700);
    console.log('区间弹层');
    await shot('shot-ledger-range');
  }

  if (want('stats')) {
    await mp.reLaunch('/pages/stats/index');
    await sleep(1500);
    await mp.pageScrollTo(0, 0);
    await sleep(400);
    console.log('图表页（默认展开第一组明细）');
    await shot('shot-stats');
    // 滚到排行区
    await mp.pageScrollTo(420, 0);
    await sleep(600);
    console.log('图表页排行 + 明细');
    await shot('shot-stats-rank');
  }

  if (want('settings')) {
    await mp.reLaunch('/pages/settings/index');
    await sleep(1000);
    console.log('我的页');
    await shot('shot-settings');
  }

  await mp.disconnect();
  console.log('\n完成');
})().catch((err) => {
  console.error('失败:', err && err.message ? err.message : err);
  process.exit(1);
});
