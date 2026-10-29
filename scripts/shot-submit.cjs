/**
 * 提审用预览图截取。
 *
 * 用途：每次提审前重新生成 `preview/submit-<版本>/` 下的 5 张图。
 * 为什么不能复用旧图：界面改过（图标方案、弹窗间距）后旧截图与线上不一致，
 * 审核员拿它对照真机会发现差异。
 *
 * 依赖开发者工具自动化端口：先 `npm run auto`，再串行跑本脚本。
 */
const automator = require('miniprogram-automator');
const path = require('path');
const fs = require('fs');

const PORT = process.env.AUTO_PORT || '9420';
const VERSION = process.env.SHOT_VERSION || '1.1.2';
const OUT = path.join(__dirname, '..', 'preview', `submit-${VERSION}`);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('已连接，输出到', OUT);

  const shot = async (name) => {
    const p = path.join(OUT, name);
    await mp.screenshot({ path: p });
    console.log(`  ${name}  ${(fs.statSync(p).size / 1024).toFixed(1)} KB`);
  };

  const go = async (route, wait = 1800) => {
    await mp.reLaunch(route);
    await new Promise((r) => setTimeout(r, wait));
  };

  await go('/pages/home/index');
  await shot('01-首页.png');

  await go('/pages/record/index');
  await shot('02-记一笔.png');

  await go('/pages/ledger/index');
  await shot('03-流水.png');

  await go('/pages/stats/index', 2200);
  await shot('04-图表.png');

  // 图表页明细区在首屏下方，滚下去再截。明细默认展开第一组，不必点。
  await mp.evaluate(() => {
    wx.pageScrollTo({ scrollTop: 720, duration: 0 });
  });
  await new Promise((r) => setTimeout(r, 1200));
  await shot('05-图表明细.png');

  await mp.disconnect();
  console.log('完成');
})().catch((err) => {
  console.error('失败:', err && err.message ? err.message : err);
  process.exit(1);
});
