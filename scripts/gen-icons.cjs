/**
 * 生成 src/components/icon.scss 与 src/components/icon-names.ts
 *
 * 图标来源：Phosphor Icons **BOLD**（`@phosphor-icons/core`，devDependency，MIT）
 *
 * 为什么用 CSS mask + data-uri：WXML 不支持 <svg>；mask 方案能保住
 * `background-color: currentColor` 的父级颜色继承（全站 100+ 处依赖）。
 *
 * 为什么是 Phosphor Bold 而不是线描：
 * - Phosphor 是**填充路径**（fill，无 stroke），粗细烘焙在路径里。
 *   旧的 1.65px 描边缩到 20px 时实际线宽是 1.375px，非整数像素被抗锯齿
 *   摊成两行半灰像素，观感「虚、灰、薄」——这是渲染问题，不是审美问题。
 * - Bold 在 42px 容器 / 20px 图标下仍有明确重量。
 *
 * 为什么 back/forward/down/up 仍是手绘线描：
 * Phosphor 只有实心三角形（caret-*），用在 16px 行内箭头会被读成「播放键」，
 * 且比两侧文字重得多。故保留 chevron 并统一加粗到 2.0 以匹配 Bold 的字重。
 *
 * 用法：node scripts/gen-icons.cjs
 * 换风格：把 SOURCE_STYLE 改成 regular / fill / duotone 即可（duotone 文件名带后缀，
 * 且在本项目 42px 容器里层次不可见，不推荐）。
 */
const fs = require('fs');
const path = require('path');

const PKG = path.resolve(__dirname, '../node_modules/@phosphor-icons/core');
const SOURCE_STYLE = 'bold'; // bold | regular | fill | light | thin | duotone
const ASSETS = path.join(PKG, 'assets', SOURCE_STYLE);
const OUT_SCSS = path.resolve(__dirname, '../src/components/icon.scss');
const OUT_NAMES = path.resolve(__dirname, '../src/components/icon-names.ts');

if (!fs.existsSync(ASSETS)) {
  throw new Error(
    `找不到 ${ASSETS}，请先执行 npm install（@phosphor-icons/core 是 devDependency）`,
  );
}

/**
 * 项目图标名 → Phosphor 图标名。
 * null 表示「手绘 chevron」，不取 Phosphor。
 * 第三项是注释，只在语义相对图标名不明显时写。
 */
const MAP = [
  // ---- 导航（手绘）----
  ['back', null],
  ['forward', null],
  ['down', null],
  ['up', null],

  // ---- 操作 ----
  ['plus', 'plus'],
  ['minus', 'minus'],
  ['search', 'magnifying-glass'],
  ['camera', 'camera'],
  ['mic', 'microphone'],
  ['close', 'x'],
  ['trash', 'trash-simple'],
  ['edit', 'pencil-simple'],
  ['check', 'check'],
  ['more', 'dots-three'],

  // ---- 功能入口 ----
  ['chart', 'chart-bar'],
  ['list', 'list'],
  ['wallet', 'wallet'],
  ['book', 'book'],
  ['settings', 'gear'],
  ['pie', 'chart-pie-slice'],
  ['budget', 'target'],
  ['template', 'copy'],
  ['upload', 'upload-simple'],
  ['download', 'download-simple'],
  ['filter', 'funnel'],
  ['calendar', 'calendar-blank'],
  ['tag', 'tag'],
  ['refresh', 'arrows-clockwise'],
  ['warn', 'warning'],
  ['eye', 'eye'],

  // ---- 分类（语义已修正，见每行注释）----
  ['food', 'fork-knife'],
  ['traffic', 'bus'],
  ['shopping', 'shopping-bag'],
  ['home', 'house'],
  ['fun', 'game-controller'],
  ['medical', 'first-aid-kit'],
  ['edu', 'graduation-cap'],
  ['phone', 'device-mobile'],
  ['gift', 'gift'],
  ['finance', 'wrench', '生活服务：原图标是折线上涨箭头（金融保险改名后没换）'],
  ['other', 'dots-three-circle', '其他：原图标是两圈同心圆，无含义'],
  ['salary', 'briefcase', '职业收入：原图标是手提袋'],
  ['parttime', 'clock', '兼职收入：原图标是卡包'],
  ['invest', 'trend-up', '补贴收入'],
  ['income', 'coins', '其他收入：原图标是向下箭头，方向与「收入」相反'],
  ['project', 'folder'],
  ['merchant', 'storefront', '商户经营收入'],
  ['cash', 'money'],
  ['alipay', 'wallet'],
  ['wechat', 'wechat-logo'],
  ['card', 'bank', '储蓄卡：原与信用卡同用 credit-card，只有颜色差别'],
  ['credit', 'credit-card'],
];

/** 手绘 chevron 的路径，24 网格，线宽 2.0 */
const CHEVRONS = {
  back: 'M15 5 8 12l7 7',
  forward: 'M9 5l7 7-7 7',
  down: 'M5 9l7 7 7-7',
  up: 'M5 15l7-7 7 7',
};

function chevronSvg(d) {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
    'stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    `<path d="${d}"/></svg>`
  );
}

function phosphorSvg(name) {
  const suffix = SOURCE_STYLE === 'regular' ? '' : `-${SOURCE_STYLE}`;
  const file = path.join(ASSETS, `${name}${suffix}.svg`);
  if (!fs.existsSync(file)) {
    throw new Error(`缺失图标：${path.basename(file)}（检查 MAP 里 "${name}" 是否拼错）`);
  }
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  if (!m) throw new Error(`无法解析 SVG：${file}`);

  let inner = m[1].trim();
  // data-uri 作为独立文档渲染，currentColor 语义不可靠，统一涂黑
  inner = inner.replace(/currentColor/g, '#000');
  // 个别图标带无填充的占位矩形，对 mask 无用，去掉省字节
  inner = inner.replace(/<rect[^>]*fill="none"[^>]*\/>/g, '').trim();

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="#000">' +
    inner +
    '</svg>'
  );
}

function toUri(svg) {
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// ---- 生成 SCSS ----
const rules = [];
const names = [];
const missing = [];
let bytes = 0;

for (const [name, phos, note] of MAP) {
  let svg;
  if (phos) {
    svg = phosphorSvg(phos);
  } else {
    svg = chevronSvg(CHEVRONS[name]);
  }
  const uri = toUri(svg);
  bytes += uri.length;
  names.push(name);
  rules.push(
    (note ? `/* ${note} */\n` : '') +
      `.ic-${name} {\n` +
      `  -webkit-mask-image: url("${uri}");\n` +
      `  mask-image: url("${uri}");\n` +
      '}',
  );
}

// TabBar 的「+」历史上传了 strokeWidth={2.2}。Bold 的加号本身已够重，
// 这里保留同名变体只为兼容 <Icon strokeWidth={2.2}> 的调用，形状与 plus 相同。
rules.push(
  '/* plus 的加粗变体：仅为兼容 <Icon strokeWidth>=2 的调用；Bold 下与 plus 同形 */\n' +
    `.ic-plus--thick {\n  -webkit-mask-image: url("${toUri(phosphorSvg('plus'))}");\n` +
    `  mask-image: url("${toUri(phosphorSvg('plus'))}");\n}`,
);

const scss = `/* 自动生成，勿手改：node scripts/gen-icons.cjs
 *
 * 图标来源：Phosphor Icons ${SOURCE_STYLE.toUpperCase()}（@phosphor-icons/core，MIT）
 *   ${names.length} 个图标中 ${names.length - 4} 个取自 Phosphor，
 *   back/forward/down/up 四个 chevron 为手绘线描（Phosphor 只有实心三角形，
 *   16px 行内箭头里过重且会被读成「播放键」）。
 *
 * 实现：CSS mask + SVG data-uri。Phosphor 是填充路径（fill，无 stroke），
 * 粗细已烘焙在路径里，故 20px 下不会出现细描边的亚像素发灰。
 * viewBox 是 0 0 256 256（chevron 是 24 24），由 mask-size: contain 统一缩放。
 */

.ic {
  display: inline-block;
  width: 20px;
  height: 20px;
  flex: none;
  vertical-align: middle;
  /* 关键：颜色继承父级 color */
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: center;
  -webkit-mask-size: contain;
  mask-repeat: no-repeat;
  mask-position: center;
  mask-size: contain;
}

${rules.join('\n\n')}
`;

fs.writeFileSync(OUT_SCSS, scss, 'utf8');

const namesContent =
  '/* 自动生成，勿手改：node scripts/gen-icons.cjs */\n' +
  `export const ICON_NAMES = [\n  ${names.map((n) => `'${n}'`).join(',\n  ')},\n] as const;\n\n` +
  '/** 任意字符串也允许，但只有清单内的名字有真实图标（Icon 组件会把未知名回退到 other） */\n' +
  'export type IconName = (typeof ICON_NAMES)[number] | (string & {});\n';
fs.writeFileSync(OUT_NAMES, namesContent, 'utf8');

console.log(`图标数        : ${names.length}（+1 加粗变体）`);
console.log(`data-uri 合计 : ${(bytes / 1024).toFixed(1)} KB`);
console.log(`icon.scss     : ${(fs.statSync(OUT_SCSS).size / 1024).toFixed(1)} KB`);
console.log(`已写入        : ${path.relative(process.cwd(), OUT_SCSS)}`);
console.log(`已写入        : ${path.relative(process.cwd(), OUT_NAMES)}`);
if (missing.length) console.log('缺失:', missing.join(', '));
