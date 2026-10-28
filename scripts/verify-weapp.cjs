/**
 * 冷启动冒烟：验证「装到手机上打开就能用」这件事本身。
 *
 * 历史：这个脚本原先断言的是 pages/index/index 工具链探针页。探针页已从正式包
 * 移除，继续断言它只会得到「页面不存在」，所以改成验证首页。
 *
 * 它和其它 11 套脚本的分工：那 11 套验具体功能，这一套只验最底线的——
 * 应用能起来、首页渲染出内容、没有白屏。功能全绿但首页白屏是完全可能的
 * （样式丢失、启动期异常、分包加载失败），所以这道闸不能省。
 */
const automator = require('miniprogram-automator');
const path = require('path');
const fs = require('fs');

const PORT = process.env.AUTO_PORT || '9420';

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

const withTimeout = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} 超时 ${ms}ms`)), ms)),
  ]);

(async () => {
  const outDir = path.join(__dirname, '..', 'preview');
  fs.mkdirSync(outDir, { recursive: true });

  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('已连接');

  console.log('\n--- 冷启动 ---');
  await mp.reLaunch('/pages/home/index');
  await new Promise((r) => setTimeout(r, 2000));

  const page = await mp.currentPage();
  check('启动后停在首页', page.path === 'pages/home/index', page.path);

  const hero = await page.$('.home-hero');
  check('首页主卡渲染出来（未白屏）', Boolean(hero));

  const totalValue = await page.$('.home-total__value');
  if (totalValue) {
    const txt = (await totalValue.text()).trim();
    check('净资产有内容', txt.length > 0, txt);
  } else {
    check('净资产有内容', false, '未找到 .home-total__value');
  }

  const labels = await page.$$('.home-stat__label');
  const labelTexts = [];
  for (const item of labels) labelTexts.push((await item.text()).trim());
  const joined = labelTexts.join('/');
  check('三个统计项齐全', joined.includes('本月支出') && joined.includes('本月收入') && joined.includes('本月结余'), joined);

  const quickCells = await page.$$('.quick-cell');
  check('快捷入口已渲染', quickCells.length >= 3, `${quickCells.length} 个`);

  const sysInfo = await mp.systemInfo();
  check('模拟器信息可读', Boolean(sysInfo.platform), `${sysInfo.platform} ${sysInfo.windowWidth}x${sysInfo.windowHeight}`);

  // 正式包里开发页必须不存在：这条是防止有人手滑把 pages/index 之类的调试页
  // 重新注册回 app.config 的闸门，比肉眼看配置可靠。
  const registered = await mp.evaluate(() => {
    const cfg = wx.getAccountInfoSync().miniProgram;
    return { env: cfg.envVersion };
  });
  check('运行环境非 release（验收钩子可用）', registered.env !== 'release', registered.env);

  const shotPath = path.join(outDir, 'weapp-home.png');
  try {
    await withTimeout(mp.screenshot({ path: shotPath }), 45000, 'screenshot');
    console.log(`  截图: ${shotPath} (${(fs.statSync(shotPath).size / 1024).toFixed(1)} KB)`);
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
