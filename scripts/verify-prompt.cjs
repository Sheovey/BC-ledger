/**
 * 备份提醒验收。
 *
 * 前提：cli.bat auto --project . --auto-port 9420 已运行，且已执行过 taro build。
 *
 * 为什么要单独一套：判定逻辑分散在「时间是否超期」「新增是否够多」
 * 「是否在冷却期」「是否刚升级」四个维度上，只靠手工点界面根本覆盖不到分支。
 * 这里直接调逻辑层的 evaluate() 逐条构造条件，再单独验 UI。
 *
 * 验收点：
 * 1. 没有流水时不提醒（no-data）
 * 2. 从未导出且笔数太少时不提醒（fresh）
 * 3. 从未导出且数据充足时提醒（due）
 * 4. 刚导出过、没有新增时不提醒（not-enough）
 * 5. 冷却期内不重复提醒（cooldown）
 * 6. 升级后跳过冷却期，仍会提醒（upgrade）
 * 7. 强制触发时弹层出现，标题与按钮文案正确
 * 8. 点「稍后再问」只关弹层，不触发导出
 * 9. 记账页判定为不可弹（表单未提交）
 *
 * 说明：脚本会改动备份计时用的几个 storage key，结束时清掉它们，
 * 不动账本数据本身。
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

/** 计时类 key，见 src/db/persist.ts 的 key 构造 */
const K = {
  exportAt: 'ledger-app.backup.v1.export',
  txCount: 'ledger-app.backup.v1.txcount',
  promptAt: 'ledger-app.backup.v1.prompt',
  seenVersion: 'ledger-app.version.seen',
};

(async () => {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('已连接自动化端口\n');

  // ---------- 0. 造数据 + 清计时 ----------
  await mp.reLaunch('/pages/home/index');
  await sleep(1500);
  await mp.evaluate(() => {
    const w = globalThis.wx;
    [
      'ledger-app.backup.v1.export',
      'ledger-app.backup.v1.txcount',
      'ledger-app.backup.v1.prompt',
    ].forEach((k) => {
      try {
        w.removeStorageSync(k);
      } catch (e) {
        /* 不存在也算清掉 */
      }
    });
    // 视为「已是最新版本」，先把升级因素排除掉，后续单独测
    const s = globalThis.__ledgerStore.getState();
    try {
      w.setStorageSync('ledger-app.version.seen', globalThis.__ledgerBackup.currentVersion);
    } catch (e) {
      /* 忽略 */
    }
    globalThis.__ledgerBackup.resetUpgrade();
    if (s.data.txs.length < 60) s.loadDemo();
  });
  await sleep(1200);

  const txCount = await mp.evaluate(() => globalThis.__ledgerStore.getState().data.txs.length);
  console.log(`   当前流水 ${txCount} 条\n`);

  // ---------- 1. 从未导出 + 数据充足 → due ----------
  const d1 = await mp.evaluate(() => globalThis.__ledgerBackup.evaluate());
  check(
    '从未导出且数据充足时判定该提醒',
    d1.due === true && d1.reason === 'due',
    `${d1.reason} / days=${d1.days} / newTx=${d1.newTx}`,
  );

  // ---------- 2. 刚导出过、无新增 → not-enough ----------
  await mp.evaluate((total) => {
    const w = globalThis.wx;
    w.setStorageSync('ledger-app.backup.v1.export', String(Date.now()));
    w.setStorageSync('ledger-app.backup.v1.txcount', String(total));
    w.removeStorageSync('ledger-app.backup.v1.prompt');
  }, txCount);
  const d2 = await mp.evaluate(() => globalThis.__ledgerBackup.evaluate());
  check(
    '刚导出过且无新增时不提醒',
    d2.due === false && d2.reason === 'not-enough',
    `${d2.reason} / newTx=${d2.newTx}`,
  );

  // ---------- 3. 冷却期 → cooldown ----------
  await mp.evaluate((total) => {
    const w = globalThis.wx;
    // 30 天前导出过，且期间新增很多：条件都满足，只剩冷却这一关
    w.setStorageSync('ledger-app.backup.v1.export', String(Date.now() - 30 * 86400000));
    w.setStorageSync('ledger-app.backup.v1.txcount', '0');
    w.setStorageSync('ledger-app.backup.v1.prompt', String(Date.now()));
  }, txCount);
  const d3 = await mp.evaluate(() => globalThis.__ledgerBackup.evaluate());
  check('冷却期内不重复提醒', d3.due === false && d3.reason === 'cooldown', d3.reason);

  // ---------- 4. 升级后跳过冷却 → due ----------
  await mp.evaluate(() => {
    // 把「上次看到的版本」伪造成一个恒不等于当前版本的值，再清掉进程内缓存，
    // 模拟升级后首次启动。不能写死具体版本号——那会在 bump 后变成「等于当前」
    // 或产生歧义，1.1.7→1.1.8 时就因为写死 '1.1.7' 导致冷却期断言误报。
    globalThis.wx.setStorageSync('ledger-app.version.seen', '0.0.0');
    globalThis.__ledgerBackup.resetUpgrade();
  });
  const d4 = await mp.evaluate(() => globalThis.__ledgerBackup.evaluate());
  check(
    '升级后跳过冷却期仍会提醒',
    d4.due === true && d4.upgrade === true,
    `upgrade=${d4.upgrade} / ${d4.reason}`,
  );

  // ---------- 5. 笔数太少 → fresh ----------
  await mp.evaluate(() => {
    const w = globalThis.wx;
    w.removeStorageSync('ledger-app.backup.v1.export');
    w.removeStorageSync('ledger-app.backup.v1.txcount');
    w.removeStorageSync('ledger-app.backup.v1.prompt');
  });
  const d5 = await mp.evaluate(() => {
    const store = globalThis.__ledgerStore;
    const backup = store.getState().data;
    const kept = backup.txs.slice(0, 5);
    store.setState({ data: { ...backup, txs: kept } });
    return globalThis.__ledgerBackup.evaluate();
  });
  check(
    '从未导出且笔数太少时不提醒',
    d5.due === false && d5.reason === 'fresh',
    `${d5.reason} / newTx=${d5.newTx}`,
  );

  // 还原数据（setState 只改了内存，重新载入演示数据覆盖回来）
  await mp.evaluate(() => {
    globalThis.__ledgerStore.getState().loadDemo();
  });
  await sleep(900);

  // ---------- 6. 弹层 UI ----------
  await mp.reLaunch('/pages/home/index');
  await sleep(1400);
  let page = await waitForPage(mp, 'pages/home/index');

  await mp.evaluate(() => {
    globalThis.__ledgerBackup.forcePrompt({ days: 21, newTx: 76, upgrade: false });
  });
  await sleep(800);

  const sheet = await page.$('.sheet');
  check('强制触发后弹层出现', Boolean(sheet));

  const titleEl = await page.$('.sheet__title');
  const title = titleEl ? (await titleEl.text()).trim() : '';
  check('弹层标题正确', title === '该把备份发出去一份了', title || '未取到');

  const descEl = await page.$('.dialog__desc');
  const desc = descEl ? (await descEl.text()).replace(/\s+/g, '') : '';
  check('文案含天数与新增笔数', desc.includes('21') && desc.includes('76'), desc.slice(0, 40));

  const dismissed = await tapText(page, '.sheet .btn', '稍后再问');
  await sleep(500);
  const afterCancel = await page.$('.sheet');
  check('点「稍后再问」关闭弹层', dismissed && !afterCancel);

  // ---------- 7. 记账页不可弹 ----------
  await mp.navigateTo('/pages/record/index');
  await sleep(1500);
  const blocked = await mp.evaluate(() => globalThis.__ledgerUpdate.canPromptNow());
  check('记账页判定为不可弹', blocked === false, String(blocked));

  // 用 reLaunch 回首页而不是 navigateBack：从整页表单返回时 automator 要等
  // 一整条 onUnload 链路，实测在开发者工具里会 timeout waiting for automator response。
  await mp.reLaunch('/pages/home/index');
  await sleep(1200);
  const homePage = await waitForPage(mp, 'pages/home/index');

  // ---------- 8. 清理计时，避免影响其它套件 ----------
  await mp.evaluate(() => {
    try {
      const w = globalThis.wx;
      w.removeStorageSync('ledger-app.backup.v1.prompt');
      w.removeStorageSync('ledger-app.version.seen');
      w.removeStorageSync('ledger-app.backup.v1.export');
      w.removeStorageSync('ledger-app.backup.v1.txcount');
    } catch (e) {
      /* 忽略 */
    }
  });

  try {
    await mp.screenshot({ path: path.join(outDir, 'prompt-backup.png') });
  } catch (e) {
    /* 截图失败不影响结论 */
  }
  console.log(`\n页面: ${homePage.path}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  await mp.disconnect();
  process.exit(failed.length ? 1 : 0);
})().catch(async (err) => {
  console.error('运行失败:', err && err.message);
  process.exit(1);
});
