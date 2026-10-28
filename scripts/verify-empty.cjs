/**
 * 空数据冒烟：验「审核员第一次打开时看到什么」。
 *
 * 为什么单开一套：其余 14 套都在有数据的前提下跑，空数据是唯一没被覆盖的
 * 状态。而微信审核是拿全新环境打开小程序的——没有流水、没有项目、没有模板，
 * 只有 seed 生成的默认账本与预设分类。任何一页在这个状态下白屏、报错、
 * 或者把「0 元」显示成空白，都可能被判「功能不完整」而驳回。
 *
 * 复现方式：`resetAll()` 内部就是 `createInitialData()`，与首次启动的
 * `loadData()` 空数据分支同源，所以直接调它等价于首启，不必清 storage 重启。
 *
 * 注意：小程序逻辑层没有 document，取不到整页 innerText，这里统一从
 * EmptyState 的 `.empty__title` / `.empty__desc` 取文案。
 */
const automator = require('miniprogram-automator');
const path = require('path');
const fs = require('fs');

const PORT = process.env.AUTO_PORT || '9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** 页面断言表：key 必须有内容，must 是空态应命中的文案之一（任一即可） */
const PAGES = [
  { path: 'pages/home/index', name: '首页', key: '.home-hero', must: ['还没有任何流水'] },
  { path: 'pages/ledger/index', name: '流水', key: '.empty', must: ['没有记录'] },
  { path: 'pages/stats/index', name: '图表', key: '.shell', must: [] },
  { path: 'pages/record/index', name: '记一笔', key: '.keypad', must: [] },
  { path: 'pages/accounts/index', name: '账户', key: '.acc-head', must: [] },
  { path: 'pages/categories/index', name: '分类', key: '.cat-note', must: [] },
  { path: 'pages/books/index', name: '账本', key: '.book-card__name', must: [] },
  { path: 'pages/budget/index', name: '预算', key: '.budget-total__head', must: [] },
  { path: 'pages/projects/index', name: '项目', key: '.empty', must: ['还没有项目'] },
  { path: 'pages/templates/index', name: '模板', key: '.empty', must: ['还没有模板'] },
  { path: 'pages/settings/index', name: '我的', key: '.settings-row', must: [] },
];

/** 汇总页面上所有空态文案 */
async function emptyText(page) {
  const parts = [];
  for (const sel of ['.empty__title', '.empty__desc']) {
    const els = await page.$$(sel);
    for (const el of els) parts.push((await el.text()).trim());
  }
  return parts.join(' | ');
}

(async () => {
  const outDir = path.join(__dirname, '..', 'preview');
  fs.mkdirSync(outDir, { recursive: true });

  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('已连接');

  // 运行期异常监听：React 抛错会打 console.error，页面可能仍渲染出半截骨架，
  // 光看元素存在抓不到。事件名各版本不一，两个都挂，挂不上就降级。
  const jsErrors = [];
  const onLog = (...args) => {
    const text = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    if (/error|exception|TypeError|is not a function|undefined is not/i.test(text)) {
      jsErrors.push(text.slice(0, 200));
    }
  };
  try {
    mp.on('console', onLog);
    mp.on('exception', onLog);
  } catch {
    /* 不支持事件监听时降级为仅做元素断言 */
  }

  console.log('\n--- 1. 复位到首启状态 ---');
  await mp.reLaunch('/pages/home/index');
  await sleep(1500);
  await mp.evaluate(() => globalThis.__ledgerStore.getState().resetAll());
  await sleep(1200);

  const state = await mp.evaluate(() => {
    const d = globalThis.__ledgerStore.getState().data;
    return {
      txs: d.txs.length,
      books: d.books.length,
      accounts: d.accounts.length,
      categories: d.categories.length,
      projects: d.projects.length,
      templates: d.templates.length,
    };
  });
  check('流水已清空', state.txs === 0, `${state.txs} 条`);
  check('保留默认账本', state.books === 1, `${state.books} 个`);
  check('保留默认账户', state.accounts >= 1, `${state.accounts} 个`);
  check('保留预设分类', state.categories >= 8, `${state.categories} 个`);
  check(
    '项目与模板为空',
    state.projects === 0 && state.templates === 0,
    `项目 ${state.projects} / 模板 ${state.templates}`,
  );

  console.log('\n--- 2. 逐页打开 ---');
  for (const spec of PAGES) {
    await mp.reLaunch(`/${spec.path}`);
    await sleep(900);
    const page = await mp.currentPage();
    if (!page || page.path !== spec.path) {
      check(`${spec.name} 能打开`, false, page ? page.path : '无当前页');
      continue;
    }

    const anchor = await page.$(spec.key);
    if (!anchor) {
      check(`${spec.name} 有内容渲染`, false, `未找到 ${spec.key}`);
      continue;
    }

    if (spec.must.length === 0) {
      check(`${spec.name} 已渲染`, true, spec.key);
      continue;
    }

    const text = await emptyText(page);
    const hit = spec.must.some((m) => text.includes(m));
    check(`${spec.name} 空态文案正确`, hit, text || '未找到空态文案');
  }

  console.log('\n--- 3. 关键数字不为空白 ---');
  await mp.reLaunch('/pages/home/index');
  await sleep(1000);
  const homePage = await mp.currentPage();
  const totalEl = await homePage.$('.home-total__value');
  const totalTxt = totalEl ? (await totalEl.text()).trim() : '';
  check('净资产显示 0 而不是空白', /0\.00/.test(totalTxt), totalTxt || '空白');

  const statValues = await homePage.$$('.home-stat__value');
  const statTexts = [];
  for (const el of statValues) statTexts.push((await el.text()).trim());
  check(
    '三个统计项都有数值',
    statTexts.length >= 3 && statTexts.slice(0, 3).every((t) => /\d/.test(t)),
    statTexts.slice(0, 3).join(' / ') || '未找到 .home-stat__value',
  );

  console.log('\n--- 4. 运行期无 JS 异常 ---');
  check(
    '未捕获到 console 异常',
    jsErrors.length === 0,
    jsErrors.length ? jsErrors.slice(0, 3).join(' | ') : '干净',
  );

  try {
    await mp.screenshot({ path: path.join(outDir, 'empty-home.png') });
    console.log(`  截图: ${path.join(outDir, 'empty-home.png')}`);
  } catch (e) {
    console.log('  截图失败（不影响结论）:', e.message);
  }

  await mp.disconnect();

  console.log(`\n合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
  if (fail) {
    console.log('失败项：' + failures.join('、'));
    process.exit(1);
  }
})().catch((err) => {
  console.error('失败:', err && err.message ? err.message : err);
  process.exit(1);
});
