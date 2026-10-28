/**
 * 记账闭环验收：首页 → 记一笔 → 保存 → 回首页看到数据。
 *
 * 前提：cli.bat auto --project . --auto-port 9420 已运行，且已执行过 taro build。
 *
 * 验收点（每项独立判定，全绿才算通过）：
 * 1. 首页底部导航渲染出来（4 个 tab + 中间记一笔）
 * 2. 点「记一笔」能进记账页
 * 3. 键盘按键能输入金额、分类弹层能选中
 * 4. 保存后自动返回首页
 * 5. 首页金额随之变化，且 store 里 tx 数量 +1
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

(async () => {
  // ---------- 静态卫生检查：不留「点了才告诉你没做」的占位入口 ----------
  // 历史包袱：金额区右侧曾有「拍照」按钮，onClick 只弹「暂未接入」的 toast。
  // 这种入口审核员点了会记一笔「无实际功能」，用户体验上也属于说了不做。
  // 这里做静态守卫，防止以后再有人用同样的方式占位。
  {
    const recordSrc = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'pages', 'record', 'index.tsx'),
      'utf8',
    );
    const placeholderHits = recordSrc.match(/暂未接入|未实现|敬请期待|即将上线/g) || [];
    check(
      '记一笔页没有未实现的占位入口',
      placeholderHits.length === 0,
      placeholderHits.length ? `命中 ${placeholderHits.join('、')}` : '干净',
    );
  }

  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('已连接自动化端口\n');

  // ---------- 基线 ----------
  await mp.reLaunch('/pages/home/index');
  await sleep(1200);
  let page = await mp.currentPage();
  console.log('当前页面:', page.path);

  const before = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const book = s.data.books[0];
    const txs = s.data.txs.filter((t) => t.bookId === book.id);
    return { count: txs.length, total: txs.filter((t) => t.type === 'expense').reduce((a, b) => a + b.amount, 0) };
  });
  console.log('基线：流水', before.count, '条，累计支出', before.total, '分\n');

  // 首页卡片上是「本月支出」，而 before.total 是全时段累计 —— 两者只在数据全落本月时才相等。
  // 一旦别的脚本播了上月流水，拿累计去比本月必然对不上（不是产品问题，是断言口径错）。
  // 所以这里改成读 DOM 拿本月基线，再看新增后是否正好 +12.50。
  const expenseBeforeText = await (async () => {
    const vals = await page.$$('.home-stat__value');
    return vals.length ? (await vals[0].text()).trim() : '';
  })();
  console.log('首页本月支出基线:', expenseBeforeText, '\n');

  // ---------- 1. TabBar ----------
  const tabs = await page.$$('.tabbar__item');
  const addBtn = await page.$('.tabbar__add');
  check('首页渲染底部导航', tabs.length === 4 && Boolean(addBtn), `4 个 tab=${tabs.length}，记一笔=${Boolean(addBtn)}`);

  const tabTexts = [];
  for (const t of tabs) tabTexts.push((await t.text()).trim());
  check('Tab 文案正确', tabTexts.join('/') === '首页/流水/图表/我的', tabTexts.join('/'));

  if (!addBtn) {
    await mp.disconnect();
    process.exit(1);
  }

  // ---------- 2. 进入记账页 ----------
  await addBtn.tap();
  await sleep(1000);
  page = await mp.currentPage();
  check('点「记一笔」进入记账页', page.path.includes('pages/record/index'), page.path);

  const keys = await page.$$('.key');
  const fields = await page.$$('.record__field');
  check('键盘与表单渲染', keys.length === 15 && fields.length >= 3, `键=${keys.length}，字段=${fields.length}`);

  // ---------- 3. 输入金额 12.5 ----------
  await tapText(page, '.key', '1');
  await tapText(page, '.key', '2');
  await tapText(page, '.key', '.');
  await tapText(page, '.key', '5');
  await sleep(300);
  let amountEl = await page.$('.record__amount');
  const amountText = amountEl ? (await amountEl.text()).trim() : '';
  check('键盘输入金额', amountText === '12.5', `显示 ${amountText}`);

  // ---------- 4. 选分类 ----------
  await fields[0].tap();
  await sleep(600);
  const roots = await page.$$('.cat-item');
  check('分类弹层打开', roots.length > 0, `根分类 ${roots.length} 个`);
  if (roots.length) {
    await roots[0].tap();
    await sleep(400);
    const subs = await page.$$('.cat-sub');
    if (subs.length) {
      await subs[0].tap();
      await sleep(400);
    }
  }
  const catValue = (await page.$$('.record__field-value'))[0];
  const catName = catValue ? (await catValue.text()).trim() : '';
  check('分类已选中', catName !== '选择分类' && catName !== '', catName);

  // ---------- 5. 保存 ----------
  const saveBtn = await page.$('.record__save');
  await saveBtn.tap();
  await sleep(1500);
  page = await mp.currentPage();
  check('保存后自动返回', page.path.includes('pages/home/index'), page.path);

  // ---------- 6. 数据落地 ----------
  const after = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const book = s.data.books[0];
    const txs = s.data.txs.filter((t) => t.bookId === book.id);
    // addTx 是插在数组头部，按 createdAt 取最新才可靠
    const last = [...txs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    return {
      count: txs.length,
      total: txs.filter((t) => t.type === 'expense').reduce((a, b) => a + b.amount, 0),
      last: last ? { amount: last.amount, categoryId: last.categoryId } : null,
    };
  });
  check('流水条数 +1', after.count === before.count + 1, `${before.count} → ${after.count}`);
  check('新增金额为 1250 分', after.last && after.last.amount === 1250, JSON.stringify(after.last));

  // 首页上的本月支出是否跟着变（读 DOM，验证的是渲染而不只是内存）
  await sleep(600);
  const statValues = await page.$$('.home-stat__value');
  const expenseText = statValues.length ? (await statValues[0].text()).trim() : '';
  const expected = (Number(expenseBeforeText.replace(/[^\d.-]/g, '')) + 12.5).toFixed(2);
  check('首页本月支出已刷新', expenseText === expected, `页面 ${expenseText} / 期望 ${expected}`);

  // ---------- 截图 ----------
  try {
    const shot = path.join(outDir, 'record-flow-home.png');
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
