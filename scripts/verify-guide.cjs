/**
 * 首次引导 + 升级前备份拦截 + 反馈入口 验收。
 *
 * 前提：cli.bat auto --project . --auto-port 9420 已运行，且已执行过 taro build。
 *
 * 为什么这三块放一套：
 * 它们都挂在「启动与入口」这条线上，且都涉及「什么时候不该打扰用户」。
 * 分开写会各自重建一遍数据和时序，反而更难复现叠加场景。
 *
 * 验收点：
 * 1. 引导首次出现（清标记后重新进入首页）
 * 2. 引导期间 tabBar 已隐藏（sheetDepth > 0）
 * 3. 引导文案含定位、优点、风险三段关键信息
 * 4. 引导期间不叠加备份弹层
 * 5. 点「我知道了」后引导消失且写入标记
 * 6. 再次进入不再出现
 * 7. 升级前判据：有未备份新增时拦截
 * 8. 升级前判据：已全部备份时不拦截
 * 9. 升级前弹层文案与按钮是「更新前」那一套
 * 10. 点「直接更新」关闭弹层并触发后续回调（重启流程不能断）
 * 11. 设置页有反馈入口
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

(async () => {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('已连接自动化端口\n');

  // ---------- 0. 造数据 + 清引导标记 ----------
  await mp.reLaunch('/pages/home/index');
  await sleep(1500);
  await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    if (s.data.txs.length < 20) s.loadDemo();
    globalThis.__ledgerGuide.reset();
  });
  await sleep(600);

  // ---------- 1~4. 引导外观与内容 ----------
  await mp.reLaunch('/pages/home/index');
  await sleep(1800);
  let page = await waitForPage(mp, 'pages/home/index');

  const guide = await page.$('.guide');
  check('首次进入弹出使用引导', Boolean(guide));

  const depth = await mp.evaluate(() => globalThis.__ledgerUi.getState().sheetDepth);
  check('引导期间 tabBar 已隐藏（sheetDepth > 0）', depth > 0, `depth=${depth}`);

  const card = await page.$('.guide__card');
  const guideText = card ? (await card.text()).replace(/\s+/g, '') : '';
  check('引导说明「不上传服务器」', guideText.includes('不上传任何服务器'), guideText.slice(0, 30));
  check('引导说明数据丢失风险', guideText.includes('删除小程序') && guideText.includes('换手机'));
  check('引导给出备份出路', guideText.includes('导出完整备份'));

  const stacked = await page.$('.sheet');
  check('引导期间不叠加备份弹层', !stacked);

  // ---------- 5~6. 确认后继续使用 ----------
  const accepted = await tapText(page, '.guide__btn', '我知道了');
  await sleep(700);
  const afterAccept = await page.$('.guide');
  check('点「我知道了」后引导消失', accepted && !afterAccept);

  const done = await mp.evaluate(() => globalThis.__ledgerGuide.isDone());
  check('引导标记已写入', done === true, String(done));

  await mp.reLaunch('/pages/home/index');
  await sleep(1600);
  page = await waitForPage(mp, 'pages/home/index');
  const again = await page.$('.guide');
  check('再次进入不再弹引导', !again);

  const canAuto = await mp.evaluate(() => globalThis.__ledgerGuide.canAutoShow());
  check('已读后自动弹出判定为 false', canAuto === false, String(canAuto));

  // ---------- 7~8. 升级前判据 ----------
  const probeWithNew = await mp.evaluate(() => {
    const w = globalThis.wx;
    w.removeStorageSync('ledger-app.backup.v1.export');
    w.removeStorageSync('ledger-app.backup.v1.txcount');
    return globalThis.__ledgerBackup.preUpgradeProbe();
  });
  check('有未备份新增时升级前会拦截', probeWithNew === true, String(probeWithNew));

  const probeAllBacked = await mp.evaluate(() => {
    const total = globalThis.__ledgerStore.getState().data.txs.length;
    const w = globalThis.wx;
    w.setStorageSync('ledger-app.backup.v1.export', String(Date.now()));
    w.setStorageSync('ledger-app.backup.v1.txcount', String(total));
    return globalThis.__ledgerBackup.preUpgradeProbe();
  });
  check('已全部备份时升级前不拦截', probeAllBacked === false, String(probeAllBacked));

  // ---------- 9~10. 升级前弹层的文案与回调 ----------
  await mp.evaluate(() => {
    globalThis.wx.removeStorageSync('ledger-app.backup.v1.txcount');
  });
  const runsBefore = await mp.evaluate(() => globalThis.__ledgerBackup.afterRuns());

  const shown = await mp.evaluate(() => globalThis.__ledgerBackup.preUpgrade());
  await sleep(700);
  check('升级前拦截真的弹出弹层', shown === true, String(shown));

  const titleEl = await page.$('.sheet__title');
  const title = titleEl ? (await titleEl.text()).trim() : '';
  check('弹层用「更新前」文案', title === '更新前先备份一份', title || '未取到');

  const skipped = await tapText(page, '.sheet .btn', '直接更新');
  await sleep(800);
  const afterSkip = await page.$('.sheet');
  check('点「直接更新」关闭弹层', skipped && !afterSkip);

  const runsAfter = await mp.evaluate(() => globalThis.__ledgerBackup.afterRuns());
  check(
    '跳过备份后仍会接上重启流程',
    runsAfter === runsBefore + 1,
    `${runsBefore} → ${runsAfter}`,
  );

  // ---------- 11. 反馈入口 ----------
  await mp.reLaunch('/pages/settings/index');
  await sleep(1500);
  page = await waitForPage(mp, 'pages/settings/index');

  const fb = await page.$('.settings-row--button');
  const fbText = fb ? (await fb.text()).replace(/\s+/g, '') : '';
  check('设置页有反馈入口', Boolean(fb) && fbText.includes('反馈与建议'), fbText.slice(0, 24));

  let openType = '';
  try {
    openType = (await fb.attribute('open-type')) || '';
  } catch (e) {
    openType = '';
  }
  check('反馈入口是客服会话按钮', openType === 'contact', openType || '读取不到，需真机点验');

  // ---------- 收尾：恢复标记与计时 ----------
  await mp.evaluate(() => {
    globalThis.__ledgerGuide.mark();
    const w = globalThis.wx;
    w.removeStorageSync('ledger-app.backup.v1.export');
    w.removeStorageSync('ledger-app.backup.v1.txcount');
    w.removeStorageSync('ledger-app.backup.v1.prompt');
  });

  try {
    await mp.screenshot({ path: path.join(outDir, 'guide-first-run.png') });
  } catch (e) {
    /* 截图失败不影响结论 */
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  await mp.disconnect();
  process.exit(failed.length ? 1 : 0);
})().catch(async (err) => {
  console.error('运行失败:', err && err.message);
  process.exit(1);
});
