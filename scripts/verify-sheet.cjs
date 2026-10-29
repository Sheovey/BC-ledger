/**
 * 弹层排版验收：防止「共享组件的样式被写在页面级 scss 里」这个 bug 回潮。
 *
 * 背景：`ConfirmDialog` 是 `components/Sheet.tsx` 里的共享组件，7 个页面在用；
 * 但 `.dialog__desc` / `.dialog__actions` 两条样式曾经写在 `pages/record/index.scss`。
 * 小程序页面样式彼此隔离，于是只有记账页的确认框是对的，其余 6 页（我的 / 账户 /
 * 账本 / 分类 / 项目 / 模板）表现成：说明文字贴死屏幕左右边缘、两个按钮挤在左侧
 * 只占文字宽度。开发者工具里看起来「只是丑」，但那是布局塌了，不是审美问题。
 *
 * 判据（本脚本固化的规则）：
 *   R1  `.dialog__*` 必须定义在全局 components.scss，且不许在页面 scss 里重复定义。
 *   R2  编译产物 app.wxss 里必须真的有这两条，并带 `flex: 1`（否则按钮不会均分）。
 *   R3  ConfirmDialog 的两个按钮必须挂 hoverClass（按下要有反馈，符合全站规范）。
 *   R4  `.sheet` 不许自己再加 `padding-bottom: env(...)`：安全区只由 `.sheet__body`
 *       留一次，两处叠加会让弹层底部凭空多出 30 多 px 空白。
 *   R5  通用规则：被 ≥2 个文件使用的类，不许只定义在页面级 scss（防下一个共享组件重犯）。
 *   R6  运行时：真的点开「清空所有数据」，确认弹窗结构完整并截图。
 *
 * 前提：已执行 taro build；运行时部分还需要 cli auto 已开（9420 端口）。
 * 静态部分（R1~R5）即使连不上自动化也会先跑完。
 */
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const SRC = path.join(root, 'src');
const DIST = path.join(root, 'dist');
const OUT = path.join(root, 'preview');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 递归收集文件 */
function walk(dir, exts, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, exts, acc);
    else if (exts.includes(path.extname(name))) acc.push(full);
  }
  return acc;
}

/** 剥掉 CSS 注释，避免本项目里大量「说明文字」被当真命中 */
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

/** 取某文件中某个类选择器的规则体（含嵌套，粗粒度匹配到下一个同级 `}` 块结束） */
function ruleBody(css, cls) {
  const i = css.indexOf(`.${cls}`);
  if (i < 0) return '';
  return css.slice(i, i + 400);
}

const globalScss = stripCss(fs.readFileSync(path.join(SRC, 'styles/components.scss'), 'utf8'));
const pageScss = walk(path.join(SRC, 'pages'), ['.scss']);
const pageScssText = new Map(pageScss.map((f) => [f, stripCss(fs.readFileSync(f, 'utf8'))]));

/* ---------- R1 全局定义 + 页面禁写 ---------- */
check(
  'R1a .dialog__desc 定义在全局 components.scss',
  globalScss.includes('.dialog__desc'),
);
check(
  'R1b .dialog__actions 定义在全局 components.scss',
  globalScss.includes('.dialog__actions'),
);

const dupPages = [...pageScssText.entries()]
  .filter(([, css]) => /\.dialog__(desc|actions)/.test(css))
  .map(([f]) => path.relative(root, f));
check(
  'R1c 页面级 scss 里没有重复定义 .dialog__*',
  dupPages.length === 0,
  dupPages.length ? `违规文件: ${dupPages.join(', ')}` : '符合',
);

/* ---------- R2 构建产物 ---------- */
const appWxss = path.join(DIST, 'app.wxss');
if (fs.existsSync(appWxss)) {
  const css = fs.readFileSync(appWxss, 'utf8');
  const hasDesc = css.includes('.dialog__desc');
  const hasActions = css.includes('.dialog__actions');
  // 压缩后可能是 flex:1 / flex:1; / flex: 1，用宽松正则
  const hasFlex = /\.dialog__actions\s+\.btn\s*\{[^}]*flex\s*:\s*1/.test(css);
  check('R2a app.wxss 含 .dialog__desc', hasDesc);
  check('R2b app.wxss 含 .dialog__actions 且按钮 flex:1', hasActions && hasFlex, hasFlex ? '' : '未找到 flex:1');
} else {
  check('R2 app.wxss 尚未生成', false, '请先执行 npm run build:weapp');
}

/* ---------- R3 ConfirmDialog 按压反馈 ---------- */
const sheetTsx = fs.readFileSync(path.join(SRC, 'components/Sheet.tsx'), 'utf8');
const actionsBlock = sheetTsx.slice(sheetTsx.indexOf("className='dialog__actions'"));
const dialogBtns = (actionsBlock.slice(0, 900).match(/className=['{][^>]*btn/g) || []).length;
const hoverCount = (actionsBlock.slice(0, 900).match(/hoverClass='btn--hover'/g) || []).length;
check(
  'R3 ConfirmDialog 两个按钮都挂了 hoverClass',
  dialogBtns >= 2 && hoverCount >= 2,
  `${hoverCount}/${dialogBtns}`,
);
check(
  'R3b 已移除内联 style={{ flex: 1 }}',
  !/style=\{\{\s*flex:\s*1\s*\}\}/.test(actionsBlock.slice(0, 900)),
);

/* ---------- R4 安全区不重复 ---------- */
const sheetRule = ruleBody(globalScss, 'sheet {');
check(
  'R4 .sheet 内不再叠加 padding-bottom: env()',
  !/padding-bottom\s*:\s*env\(/.test(sheetRule),
  /padding-bottom\s*:\s*env\(/.test(sheetRule) ? '发现重复安全区' : '符合',
);

/* ---------- R5 通用规则：共享类不许只在页面级定义 ---------- */
const users = new Map(); // className -> Set<file>
for (const f of walk(SRC, ['.tsx'])) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/className=(?:'([^']*)'|\{`([^`]*)`\})/g)) {
    const clean = (m[1] || m[2] || '').replace(/\$\{[^}]*\}/g, ' ');
    for (const c of clean.split(/\s+/)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(c) || c.length <= 2) continue;
      if (!users.has(c)) users.set(c, new Set());
      users.get(c).add(f);
    }
  }
}
const defs = new Map(); // className -> Set<file>
for (const f of walk(SRC, ['.scss'])) {
  const css = stripCss(fs.readFileSync(f, 'utf8'));
  for (const m of css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) {
    const c = m[1];
    if (!defs.has(c)) defs.set(c, new Set());
    defs.get(c).add(f);
  }
}
const isGlobalFile = (f) => /[\\/]src[\\/](styles|components)[\\/]/.test(f);
const violations = [];
for (const [cls, files] of users) {
  // 只在「页面 tsx」里用（组件文件里的用法不构成跨页共享）
  const pageUsers = [...files].filter((f) => /[\\/]src[\\/]pages[\\/]/.test(f));
  if (pageUsers.length < 2) continue;
  const where = defs.get(cls);
  if (!where) continue;
  // 页面 tsx 与它的页面 scss 同目录时属于「本页私有样式」，不算违规
  const ownerDirs = pageUsers.map((f) => path.dirname(f));
  const definedInOwn = [...where].some(
    (f) => ownerDirs.includes(path.dirname(f)) || isGlobalFile(f),
  );
  if (!definedInOwn) violations.push(`.${cls}（${pageUsers.length} 页使用）`);
}
check(
  'R5 没有「多页共用却只定义在页面级」的类',
  violations.length === 0,
  violations.length ? violations.slice(0, 6).join('、') : '符合',
);

/* ---------- R6 运行时 ---------- */
(async () => {
  const automator = require('miniprogram-automator');
  const PORT = process.env.AUTO_PORT || '9420';
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  } catch (e) {
    console.log('\n⚠️  连不上自动化（9420），运行时检查跳过。静态结论仍然有效。');
    report();
    return;
  }

  try {
    // 先回首页热身：连接刚建立时小程序可能还没完成 launch，
    // 直接 reLaunch 目标页会抛 getPageMetaByWebviewId(...) is null。
    await mp.reLaunch('/pages/home/index');
    await sleep(1500);

    await mp.reLaunch('/pages/settings/index');
    await sleep(1000);

    // 注意：$ / $$ 挂在 Page 上，miniProgram 实例只有 tap/reLaunch/evaluate 这些。
    const page = await mp.currentPage();

    const rows = await page.$$('.settings-row');
    let tapped = false;
    for (const row of rows) {
      const t = (await row.text()).trim();
      if (t.includes('清空所有数据')) {
        await row.tap();
        tapped = true;
        break;
      }
    }
    check('R6a 能点开「清空所有数据」确认框', tapped);
    await sleep(600);

    const descEl = await page.$('.dialog__desc');
    check('R6b 弹窗里有 .dialog__desc', Boolean(descEl));

    const actionEl = await page.$('.dialog__actions');
    check('R6c 弹窗里有 .dialog__actions', Boolean(actionEl));

    const btns = await page.$$('.dialog__actions .btn');
    check('R6d 操作区恰好两个按钮', btns.length === 2, `实际 ${btns.length}`);

    // 均分判据：两个按钮的横向位置必须一左一右，且左按钮不是「只包文字」
    if (btns.length === 2) {
      const o1 = await btns[0].offset();
      const o2 = await btns[1].offset();
      check(
        'R6e 两个按钮左右排布（非挤在同一侧）',
        o2.left - o1.left > 100,
        `left: ${o1.left} → ${o2.left}`,
      );
      check(
        'R6f 左按钮起始位有 18px 留白（不贴边）',
        o1.left >= 15,
        `left=${o1.left}`,
      );
    }

    const shot = path.join(OUT, 'sheet-confirm.png');
    await mp.screenshot({ path: shot });
    console.log(`\n截图: ${shot}`);

    // 关掉弹窗，避免影响后续脚本（page 本身没有 tap，只能拿到元素再点）
    const overlay = await page.$('.overlay');
    if (overlay) await overlay.tap();
    await sleep(300);
  } catch (e) {
    check('R6 运行时检查执行', false, e.message);
  }

  await mp.disconnect();
  report();
})();

function report() {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
}
