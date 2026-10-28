/**
 * 预算页验收。
 *
 * 前提：cli.bat auto --project . --auto-port 9420 已运行，且已执行过 taro build。
 *
 * 路径：首页 → 底栏「我的」→「预算」。
 *
 * 验收点：
 * 1. 进入页面，标题「预算」、副标题为账本名
 * 2. 未设置时显示「未设置」与提示文案
 * 3. 设置总预算 2000 → 显示 ¥2000.00，落库 200000 分、month='*'
 * 4. 设置后出现进度条与「已支出 / 剩余」文案
 * 5. 添加分类预算（餐饮 500）→ 出现行，落库 categoryId 正确
 * 6. 分类行显示「已用 x%」
 * 7. 删除分类预算 → 行消失且库里不再有
 * 8. 总预算改回 0 → 显示「未设置」（取消预算）
 * 9. 返回键回到设置页
 *
 * 说明：只清理由本脚本写入的两条预算（总预算 + 餐饮），不动其它分类预算。
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
      await sleep(500);
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
    const t = (await el.text()).replace(/\s+/g, '');
    if (t === text || t.startsWith(text)) {
      await el.tap();
      return true;
    }
  }
  return false;
}

/** 清空测试用预算（总预算与餐饮分类），返回清理条数 */
async function clearBudgets(mp) {
  return await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const bookId = s.data.settings.lastBookId ?? s.data.books[0]?.id;
    const junk = s.data.budgets.filter(
      (b) => b.bookId === bookId && (b.categoryId === null || b.categoryId === 'cat_food'),
    );
    if (!junk.length) return 0;
    const ids = junk.map((b) => b.id);
    globalThis.__ledgerStore.getState().importData({
      ...s.data,
      budgets: s.data.budgets.filter((b) => !ids.includes(b.id)),
    });
    return junk.length;
  });
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('已连接自动化端口\n');

  const bookName = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    return s.data.books.find((b) => b.id === s.data.settings.lastBookId)?.name ?? s.data.books[0].name;
  });

  const cleared = await clearBudgets(mp);
  console.log(cleared ? `清理了 ${cleared} 条上次残留的测试预算\n` : '无残留测试预算\n');

  // ---------- 1. 我的 → 预算 ----------
  await mp.reLaunch('/pages/home/index');
  await sleep(1500);
  let page = await mp.currentPage();
  await tapText(page, '.tabbar__item', '我的');
  page = await waitForPage(mp, 'pages/settings/index');

  const entered = await tapText(page, '.settings-row', '预算');
  page = await waitForPage(mp, 'pages/budget/index');
  check('从「我的」进入预算页', entered && page.path.includes('pages/budget/index'), page.path);

  const titleEl = await page.$('.page-head__title');
  const title = titleEl ? (await titleEl.text()).trim() : '';
  check('标题为「预算」', title === '预算', title);
  const subEl = await page.$('.page-head__sub');
  const sub = subEl ? (await subEl.text()).trim() : '';
  check('副标题为账本名', sub === bookName, `页面 ${sub} / 期望 ${bookName}`);

  // ---------- 2. 未设置状态 ----------
  const amountEl = await page.$('.budget-total__amount');
  const amountText = amountEl ? (await amountEl.text()).replace(/\s/g, '') : '';
  check('初始显示「未设置」', amountText === '未设置', amountText);
  const hintEl = await page.$('.budget-hint');
  check('未设置时有说明文案', Boolean(hintEl));

  // ---------- 3. 设置总预算 ----------
  await tapText(page, '.text-btn', '设置');
  await sleep(900);
  const sheetTitle = await page.$('.sheet__title');
  const st = sheetTitle ? (await sheetTitle.text()).trim() : '';
  check('弹层标题为「月度总预算」', st === '月度总预算', st);
  await (await page.$('.budget-form .input')).input('2000');
  await sleep(300);
  await (await page.$('.budget-submit')).tap();
  await sleep(1300);
  check('保存后弹层关闭', !(await page.$('.sheet')));

  const amountAfter = await page.$('.budget-total__amount');
  const amountAfterText = amountAfter ? (await amountAfter.text()).replace(/[\s,]/g, '') : '';
  check('总预算显示 ¥2000.00', amountAfterText.includes('2000.00'), amountAfterText);

  const budgetRow = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const bookId = s.data.settings.lastBookId ?? s.data.books[0].id;
    const b = s.data.budgets.find((x) => x.bookId === bookId && x.categoryId === null);
    return b ? { amount: b.amount, month: b.month } : null;
  });
  check('总预算落库 200000 分', Boolean(budgetRow && budgetRow.amount === 200000), JSON.stringify(budgetRow));
  check('预算按月通用（month=*）', Boolean(budgetRow && budgetRow.month === '*'), budgetRow ? budgetRow.month : '');

  // ---------- 4. 进度与文案 ----------
  const progress = await page.$('.progress__fill');
  check('出现进度条', Boolean(progress));
  const footText = await page.$('.budget-total__foot');
  const ft = footText ? (await footText.text()).replace(/\s+/g, '') : '';
  check('显示「已支出」与「剩余/超支」', ft.includes('已支出') && (ft.includes('剩余') || ft.includes('超支')), ft);

  // ---------- 5. 添加分类预算 ----------
  await tapText(page, '.text-btn', '添加');
  await sleep(900);
  const addTitleEl = await page.$('.sheet__title');
  const at = addTitleEl ? (await addTitleEl.text()).trim() : '';
  check('弹层标题为「添加分类预算」', at === '添加分类预算', at);

  const picked = await tapText(page, '.budget-chip', '餐饮');
  await sleep(300);
  check('选中「餐饮」分类', picked);
  await (await page.$('.budget-form .input')).input('500');
  await sleep(300);
  await (await page.$('.budget-submit')).tap();
  await sleep(1300);

  const rows = await page.$$('.budget-row');
  check('分类预算行出现', rows.length >= 1, `${rows.length} 行`);
  const rowTexts = [];
  for (const row of rows) rowTexts.push((await row.text()).replace(/\s+/g, ''));
  check('行内为「餐饮」', rowTexts.some((t) => t.startsWith('餐饮')), rowTexts.join(' | '));

  const catBudget = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const bookId = s.data.settings.lastBookId ?? s.data.books[0].id;
    const b = s.data.budgets.find((x) => x.bookId === bookId && x.categoryId === 'cat_food');
    return b ? { amount: b.amount, month: b.month } : null;
  });
  check('分类预算落库 50000 分', Boolean(catBudget && catBudget.amount === 50000), JSON.stringify(catBudget));

  // ---------- 6. 分类行文案 ----------
  const foots = await page.$$('.budget-row__foot');
  const footTexts = [];
  for (const f of foots) footTexts.push((await f.text()).replace(/\s+/g, ''));
  check(
    '分类行显示百分比用量',
    footTexts.some((t) => t.includes('%')),
    footTexts.join(' | '),
  );

  // ---------- 7. 删除分类预算 ----------
  const rows2 = await page.$$('.budget-row');
  let targetRow = null;
  for (const row of rows2) {
    const t = (await row.text()).replace(/\s+/g, '');
    if (t.startsWith('餐饮')) {
      targetRow = row;
      break;
    }
  }
  const rowsBefore = rows2.length;
  await (await targetRow.$('.budget-row__del')).tap();
  await sleep(1300);
  const rowsAfter = (await page.$$('.budget-row')).length;
  check('删除后行数 -1', rowsAfter === rowsBefore - 1, `${rowsBefore} → ${rowsAfter}`);
  const catGone = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const bookId = s.data.settings.lastBookId ?? s.data.books[0].id;
    return !s.data.budgets.some((x) => x.bookId === bookId && x.categoryId === 'cat_food');
  });
  check('分类预算已从库里移除', catGone);

  // ---------- 8. 取消总预算（填 0） ----------
  await tapText(page, '.text-btn', '修改');
  await sleep(900);
  const totalInput = await page.$('.budget-form .input');
  await totalInput.input('0');
  await sleep(300);
  await (await page.$('.budget-submit')).tap();
  await sleep(1300);
  const amountFinal = await page.$('.budget-total__amount');
  const finalText = amountFinal ? (await amountFinal.text()).replace(/\s/g, '') : '';
  check('填写 0 后回到「未设置」', finalText === '未设置', finalText);
  const zeroed = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const bookId = s.data.settings.lastBookId ?? s.data.books[0].id;
    const b = s.data.budgets.find((x) => x.bookId === bookId && x.categoryId === null);
    return b ? b.amount : null;
  });
  check('总预算金额归零', zeroed === 0, String(zeroed));

  // ---------- 9. 返回 ----------
  const backBtns = await page.$$('.page-head .icon-btn');
  await backBtns[0].tap();
  page = await waitForPage(mp, 'pages/settings/index');
  check('返回键回到设置页', page.path.includes('pages/settings/index'), page.path);

  // ---------- 截图：留一份「有预算」的状态 ----------
  await clearBudgets(mp);
  await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const bookId = s.data.settings.lastBookId ?? s.data.books[0].id;
    globalThis.__ledgerStore.getState().importData({
      ...s.data,
      budgets: [
        ...s.data.budgets,
        { id: 'budget_shot_total', bookId, month: '*', categoryId: null, amount: 300000 },
        { id: 'budget_shot_food', bookId, month: '*', categoryId: 'cat_food', amount: 120000 },
        { id: 'budget_shot_traffic', bookId, month: '*', categoryId: 'cat_traffic', amount: 40000 },
      ],
    });
  });
  await mp.reLaunch('/pages/budget/index');
  await sleep(1600);
  try {
    const shot = path.join(outDir, 'budget-page.png');
    await mp.screenshot({ path: shot });
    console.log(`\n截图: ${shot}`);
  } catch (e) {
    console.log('截图失败（不影响结论）:', e.message);
  }

  // 截图用的三条预算只是展示态，拍完就撤，避免下次运行基线漂移
  await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    globalThis.__ledgerStore.getState().importData({
      ...s.data,
      budgets: s.data.budgets.filter((b) => !b.id.startsWith('budget_shot_')),
    });
  });

  await mp.disconnect();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('失败:', err && err.message ? err.message : err);
  process.exit(1);
});
