/**
 * 设置页验收：底栏入口、分组渲染、偏好设置弹层生效、数据操作。
 *
 * 前提：cli.bat auto --project . --auto-port 9420 已运行，且已执行过 taro build。
 *
 * 说明：最后会真的清空一次数据（这是被验收的功能本身），
 * 清空后补种 3 条固定流水，避免后续手工看界面时是空的。
 *
 * 验收点：
 * 1. 底栏点「我的」能进设置页，标题正确
 * 2. 账本卡片、6 个管理入口、数据项、关于项都渲染出来
 * 3. 货币符号改成 $ 后 store 与页面同步变化，改回 ¥ 也生效
 * 4. 每月起始日改成 10 日后生效，改回 1 日
 * 5. 载入演示数据后流水条数明显增加
 * 6. 清空所有数据后流水归零、账本重建
 * 7. 存储占用不是「未知」
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
    if (t === text || t.startsWith(text)) {
      await el.tap();
      return true;
    }
  }
  return false;
}

/** 读某个设置组的全部行文案，用来断言分组结构 */
async function rowTexts(page) {
  const rows = await page.$$('.settings-row');
  const out = [];
  for (const row of rows) out.push((await row.text()).replace(/\s+/g, ' ').trim());
  return out;
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('已连接自动化端口\n');

  // ---------- 1. 从底栏进设置页 ----------
  await mp.reLaunch('/pages/home/index');
  await sleep(1500);
  let page = await mp.currentPage();
  const entered = await tapText(page, '.tabbar__item', '我的');
  check('底栏有「我的」入口', entered);
  page = await waitForPage(mp, 'pages/settings/index');
  check('进入设置页', page.path.includes('pages/settings/index'), page.path);

  const titleEl = await page.$('.settings-head__title');
  const title = titleEl ? (await titleEl.text()).trim() : '';
  check('标题为「我的」', title === '我的', title);

  // ---------- 2. 结构渲染 ----------
  const bookCard = await page.$('.book-card');
  const bookNameEl = await page.$('.book-card__name');
  const bookName = bookNameEl ? (await bookNameEl.text()).trim() : '';
  check('顶部账本卡片存在', Boolean(bookCard), bookName);

  const groups = await page.$$('.settings-group__title');
  const groupTitles = [];
  for (const g of groups) groupTitles.push((await g.text()).trim());
  // 用集合包含而不是精确相等：新增分组（如「本机存档」）不应打断这条断言，
  // 它真正要保证的是「五类入口都在、且没有多余的重复标题」。
  const EXPECTED_GROUPS = ['账本与科目', '偏好设置', '数据', '本机存档', '关于'];
  const missingGroups = EXPECTED_GROUPS.filter((g) => !groupTitles.includes(g));
  check(
    '五个分组齐全',
    missingGroups.length === 0 && groupTitles.length === EXPECTED_GROUPS.length,
    missingGroups.length ? `缺 ${missingGroups.join('、')}` : groupTitles.join('/'),
  );

  const texts = await rowTexts(page);
  const joined = texts.join(' | ');
  const mustHave = ['账本管理', '账户', '分类管理', '项目', '记账模板', '预算'];
  const missing = mustHave.filter((m) => !joined.includes(m));
  check('账本与科目 6 个入口齐全', missing.length === 0, missing.length ? `缺 ${missing.join('、')}` : '全部命中');

  const dataRows = [
    '导出完整备份',
    '从备份恢复',
    '回到上一个存档',
    '导出当前账本 CSV',
    '载入演示数据',
    '清空所有数据',
  ];
  const missingData = dataRows.filter((m) => !joined.includes(m));
  check('数据操作 6 项齐全', missingData.length === 0, missingData.length ? `缺 ${missingData.join('、')}` : '全部命中');

  // 存储占用
  const usageRow = texts.find((t) => t.includes('本地数据占用')) || '';
  check('显示本地数据占用', usageRow.includes('KB') || usageRow.includes('MB'), usageRow);

  // ---------- 3. 货币符号 ----------
  const beforeCurrency = await mp.evaluate(() => globalThis.__ledgerStore.getState().data.settings.currency);
  await tapText(page, '.settings-row', '货币符号');
  await sleep(900);
  const currencySheet = await page.$('.sheet');
  check('货币符号弹层打开', Boolean(currencySheet));
  const pickedDollar = await tapText(page, '.sheet .settings-row', '$');
  await sleep(700);
  const afterCurrency = await mp.evaluate(() => globalThis.__ledgerStore.getState().data.settings.currency);
  check('选 $ 后设置生效', pickedDollar && afterCurrency === '$', `${beforeCurrency} → ${afterCurrency}`);

  // 改回 ¥
  await tapText(page, '.settings-row', '货币符号');
  await sleep(800);
  await tapText(page, '.sheet .settings-row', '¥');
  await sleep(700);
  const backCurrency = await mp.evaluate(() => globalThis.__ledgerStore.getState().data.settings.currency);
  check('改回 ¥ 生效', backCurrency === '¥', backCurrency);

  // ---------- 4. 每月起始日 ----------
  await tapText(page, '.settings-row', '每月起始日');
  await sleep(900);
  const daySheet = await page.$('.sheet');
  check('每月起始日弹层打开', Boolean(daySheet));
  const hintEl = await page.$('.sheet-hint');
  check('弹层有说明文案', Boolean(hintEl), hintEl ? (await hintEl.text()).slice(0, 20) : '无');

  const pickedDay = await tapText(page, '.sheet .settings-row', '每月 10 日');
  await sleep(700);
  const afterDay = await mp.evaluate(() => globalThis.__ledgerStore.getState().data.settings.monthStartDay);
  check('选 10 日后生效', pickedDay && afterDay === 10, `${afterDay} 日`);

  await tapText(page, '.settings-row', '每月起始日');
  await sleep(800);
  await tapText(page, '.sheet .settings-row', '每月 1 日');
  await sleep(700);
  const backDay = await mp.evaluate(() => globalThis.__ledgerStore.getState().data.settings.monthStartDay);
  check('改回 1 日生效', backDay === 1, `${backDay} 日`);

  // ---------- 5. 载入演示数据 ----------
  const beforeDemo = await mp.evaluate(() => globalThis.__ledgerStore.getState().data.txs.length);
  await tapText(page, '.settings-row', '载入演示数据');
  await sleep(900);
  const dialog = await page.$('.sheet');
  check('载入演示确认框弹出', Boolean(dialog));
  const confirmed = await tapText(page, '.sheet .btn', '载入');
  await sleep(1500);
  const afterDemo = await mp.evaluate(() => globalThis.__ledgerStore.getState().data.txs.length);
  check('演示数据已写入', confirmed && afterDemo > beforeDemo + 20, `${beforeDemo} → ${afterDemo} 条`);

  // ---------- 6. 清空所有数据 ----------
  await tapText(page, '.settings-row', '清空所有数据');
  await sleep(900);
  const resetDialog = await page.$('.sheet');
  check('清空确认框弹出', Boolean(resetDialog));
  const resetOk = await tapText(page, '.sheet .btn', '确定');
  await sleep(1800);
  const afterReset = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    return { txs: s.data.txs.length, books: s.data.books.length, cats: s.data.categories.length };
  });
  check('清空后流水归零', resetOk && afterReset.txs === 0, JSON.stringify(afterReset));
  check('清空后账本重建', afterReset.books >= 1, `${afterReset.books} 个账本`);
  check('清空后分类恢复预设', afterReset.cats > 0, `${afterReset.cats} 个分类`);

  // 页面还活着（清空是重操作，最怕白屏）
  await sleep(600);
  page = await mp.currentPage();
  const stillThere = await page.$('.settings-group');
  check('清空后页面未白屏', Boolean(stillThere), page.path);

  // ---------- 7. 补种，方便手工查看 ----------
  await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const book = s.data.books[0];
    const acc = s.data.accounts.filter((a) => a.bookId === book.id && !a.archived)[0];
    const cat = s.data.categories.filter((c) => c.type === 'expense' && !c.archived)[0];
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const base = {
      bookId: book.id,
      accountId: acc ? acc.id : null,
      toAccountId: null,
      projectId: null,
      categoryId: cat ? cat.id : null,
      merchant: '',
      type: 'expense',
    };
    globalThis.__ledgerStore.getState().addTx({ ...base, amount: 1250, note: '午餐', occurredAt: `${stamp(today)}T10:00` });
    globalThis.__ledgerStore.getState().addTx({ ...base, amount: 800, note: '早餐', occurredAt: `${stamp(today)}T08:00` });
    globalThis.__ledgerStore.getState().addTx({
      ...base,
      amount: 3000,
      note: '采购',
      occurredAt: `${stamp(new Date(today.getTime() - 86400000))}T19:00`,
    });
  });
  await sleep(800);
  console.log('已补种 3 条流水');

  // ---------- 截图 ----------
  try {
    const shot = path.join(outDir, 'settings-page.png');
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
