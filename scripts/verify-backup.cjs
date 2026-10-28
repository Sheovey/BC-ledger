/**
 * 备份与恢复验收。
 *
 * 前提：cli.bat auto --project . --auto-port 9420 已运行，且已执行过 taro build。
 *
 * 为什么单独一套：
 * 「备份」曾经是坏的 —— 旧实现在 saveData 成功之后才把数据写进备份键，
 * 于是备份永远等于当前数据，回滚点什么也救不回来，而界面看起来一切正常。
 * 这种错误只有比对「备份里的条数」和「当前条数」才抓得到，光点界面抓不到。
 *
 * 验收点：
 * 1. 备份存在，且内容是「修改前」的状态（条数比当前少 1）
 * 2. 备份带时间戳，落在今天
 * 3. 设置页把备份时间显示成「今天」而不是「从未」
 * 4. 点「回到上一个存档」并确认后，流水条数回到修改前
 * 5. 恢复动作本身也会先存一份旧状态，所以能再换回来（可逆）
 * 6. 云同步默认关闭，界面显示「仅保存在本机」
 * 7. 「从备份恢复」的副文案明确提到换手机
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

/** 取某一行设置项的整段文字（含右侧值），用于断言显示内容 */
async function rowText(page, keyword) {
  const rows = await page.$$('.settings-row');
  for (const row of rows) {
    const t = (await row.text()).replace(/\s+/g, '');
    if (t.includes(keyword)) return t;
  }
  return '';
}

/** 读备份原文。key 与 persist.ts 的 backupKey() 对齐（未登录分区） */
async function readBackupRaw(mp) {
  const raw = await mp.evaluate(() => {
    try {
      const v = wx.getStorageSync('ledger-app.backup.v1');
      return typeof v === 'string' ? v : '';
    } catch (e) {
      return '';
    }
  });
  return raw || '';
}

async function main() {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });

  await mp.reLaunch('/pages/home/index');
  await sleep(1500);

  // ---------- 0. 准备一条可回滚的基线 ----------
  const baseCount = await mp.evaluate(() => globalThis.__ledgerStore.getState().data.txs.length);
  console.log(`\n起始流水 ${baseCount} 条`);

  const added = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const book = s.data.books[0];
    if (!book) return null;
    const acc = s.data.accounts.filter((a) => a.bookId === book.id && !a.archived)[0];
    const cat = s.data.categories.filter((c) => c.type === 'expense' && !c.archived)[0];
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    return s.addTx({
      bookId: book.id,
      accountId: acc ? acc.id : null,
      toAccountId: null,
      projectId: null,
      categoryId: cat ? cat.id : null,
      merchant: '备份验收',
      type: 'expense',
      amount: 3300,
      note: '用于验证备份是旧版本',
      occurredAt: `${day}T12:00`,
    });
  });
  check('能新增一条流水用于构造新旧差异', Boolean(added), added || '无可用账本');

  // 等防抖 250ms + 落盘
  await sleep(900);

  const nowCount = await mp.evaluate(() => globalThis.__ledgerStore.getState().data.txs.length);
  check('当前流水已增加 1 条', nowCount === baseCount + 1, `${baseCount} → ${nowCount}`);

  // ---------- 1. 核心：备份必须是旧版本 ----------
  const raw = await readBackupRaw(mp);
  let backupCount = -1;
  if (raw) {
    try {
      backupCount = JSON.parse(raw).txs.length;
    } catch (e) {
      backupCount = -2;
    }
  }
  check('备份键里有内容', raw.length > 0, `${raw.length} 字符`);
  check(
    '备份存的是修改前的条数，而不是当前条数',
    backupCount === baseCount,
    `备份 ${backupCount} 条 / 当前 ${nowCount} 条`,
  );

  const stampedToday = await mp.evaluate(() => {
    try {
      const v = wx.getStorageSync('ledger-app.backup.v1.at');
      if (!v) return false;
      const t = new Date(Number(v));
      const n = new Date();
      return (
        t.getFullYear() === n.getFullYear() &&
        t.getMonth() === n.getMonth() &&
        t.getDate() === n.getDate()
      );
    } catch (e) {
      return false;
    }
  });
  check('备份带时间戳且落在今天', stampedToday === true);

  // ---------- 2. 设置页入口与文案 ----------
  await mp.reLaunch('/pages/settings/index');
  await sleep(1200);
  const page = await waitForPage(mp, 'settings');

  const backupRow = await rowText(page, '回到上一个存档');
  check('设置页有「回到上一个存档」入口', backupRow.includes('回到上一个存档'), backupRow);
  check('入口右侧显示「今天」', backupRow.includes('今天'), backupRow);

  const exportRow = await rowText(page, '导出完整备份');
  check('导出项显示了上次导出时间', /从未|今天|昨天|天前|个月前|年前/.test(exportRow), exportRow);

  const importRow = await rowText(page, '从备份恢复');
  check('「从备份恢复」文案提到换手机', importRow.includes('换手机'), importRow);

  const syncRow = await rowText(page, '数据存放');
  check('云同步默认关闭，显示「仅保存在本机」', syncRow.includes('仅保存在本机'), syncRow);

  // ---------- 3. 执行恢复 ----------
  const tapped = await tapText(page, '.settings-row', '回到上一个存档');
  await sleep(600);
  check('点击后弹出确认框', tapped === true);

  const confirmed = await tapText(page, '.btn', '恢复');
  await sleep(1200);
  check('确认框有「恢复」按钮', confirmed === true);

  const afterRestore = await mp.evaluate(() => globalThis.__ledgerStore.getState().data.txs.length);
  check(
    '恢复后流水回到修改前的条数',
    afterRestore === baseCount,
    `${nowCount} → ${afterRestore}`,
  );

  // ---------- 4. 可逆：恢复动作本身也留了旧状态 ----------
  await sleep(600);
  const raw2 = await readBackupRaw(mp);
  let backupCount2 = -1;
  try {
    backupCount2 = raw2 ? JSON.parse(raw2).txs.length : -1;
  } catch (e) {
    backupCount2 = -2;
  }
  check(
    '恢复前的状态也被存进备份，可再换回来',
    backupCount2 === nowCount,
    `备份 ${backupCount2} 条 / 期望 ${nowCount} 条`,
  );

  try {
    // 数据分组在页面下半部分，先滚过去再截，否则截到的全是顶部的账本卡片
    await mp.evaluate(() => {
      try {
        wx.pageScrollTo({ scrollTop: 660, duration: 0 });
      } catch (e) {
        /* 滚动失败不影响验收结论 */
      }
    });
    await sleep(600);
    const shot = path.join(outDir, 'settings-backup.png');
    await mp.screenshot({ path: shot });
    console.log(`\n截图: ${shot}`);
  } catch (e) {
    console.log('截图失败（不影响结论）:', e.message);
  }

  await mp.disconnect();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`);
  if (failed.length) {
    failed.forEach((f) => console.log(`  ❌ ${f.label} ${f.detail}`));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('脚本异常:', e);
  process.exitCode = 1;
});
