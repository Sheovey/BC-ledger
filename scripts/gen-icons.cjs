/**
 * 把 ledger-app/src/components/Icon.tsx 里的 JSX 图标定义批量转成
 * 小程序可用的 CSS mask data-uri，生成 icon.scss。
 *
 * 为什么需要这一步：WXML 不支持 <svg>，实测可行方案是
 * -webkit-mask-image: url("data:image/svg+xml,...") + background-color: currentColor，
 * 这样既能显示图标，又能保留父级 color 继承（120 处调用依赖这一点）。
 */
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const SRC = path.resolve(
  __dirname,
  '../../ledger-app/src/components/Icon.tsx',
);
const OUT = path.resolve(__dirname, '../src/components/icon.scss');
const OUT_JSON = path.resolve(__dirname, '../preview/icon-paths.json');

/** 默认描边参数，与 Web 版 Icon 组件的默认值一致 */
const BASE = {
  fill: 'none',
  stroke: '#000',
  strokeWidth: '1.65',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

function attrToStr(a) {
  const key = a.name.name;
  if (!a.value) return key; // 布尔属性
  if (a.value.type === 'StringLiteral') return `${key}="${a.value.value}"`;
  if (a.value.type === 'NumericLiteral') return `${key}="${a.value.value}"`;
  if (a.value.type === 'JSXExpressionContainer') {
    const ex = a.value.expression;
    if (ex.type === 'StringLiteral') return `${key}="${ex.value}"`;
    if (ex.type === 'NumericLiteral') return `${key}="${ex.value}"`;
    if (ex.type === 'BooleanLiteral') return ex.value ? key : '';
  }
  throw new Error(`无法解析属性 ${key} 的值类型 ${a.value.type}`);
}

function jsxToMarkup(node) {
  if (!node) return '';
  if (node.type === 'JSXText') return node.value.trim() ? node.value : '';
  if (node.type === 'JSXExpressionContainer') return ''; // 图标集内无动态表达式
  if (node.type === 'JSXFragment') {
    return node.children.map(jsxToMarkup).join('');
  }
  if (node.type === 'JSXElement') {
    const tag = node.openingElement.name.name;
    const attrs = node.openingElement.attributes
      .map(attrToStr)
      .filter(Boolean)
      .join(' ');
    const kids = node.children.map(jsxToMarkup).join('');
    const open = attrs ? `<${tag} ${attrs}` : `<${tag}`;
    return kids ? `${open}>${kids}</${tag}>` : `${open}/>`;
  }
  throw new Error(`未知节点类型 ${node.type}`);
}

function toSvg(markup, strokeWidth = BASE.strokeWidth) {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ' +
    `fill="${BASE.fill}" stroke="${BASE.stroke}" stroke-width="${strokeWidth}" ` +
    `stroke-linecap="${BASE.strokeLinecap}" stroke-linejoin="${BASE.strokeLinejoin}">` +
    markup +
    '</svg>'
  );
}

function toDataUri(svg) {
  // 用百分号编码：小程序 WXSS 里的 url() 支持这种写法
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// ---- 解析 Icon.tsx ----
const code = fs.readFileSync(SRC, 'utf8');
const ast = parser.parse(code, {
  sourceType: 'module',
  plugins: ['jsx', 'typescript'],
});

let pathsNode = null;
for (const stmt of ast.program.body) {
  if (stmt.type !== 'VariableDeclaration') continue;
  for (const d of stmt.declarations) {
    if (d.id.type === 'Identifier' && d.id.name === 'PATHS' && d.init) {
      pathsNode = d.init;
    }
  }
}
if (!pathsNode || pathsNode.type !== 'ObjectExpression') {
  throw new Error('未找到 PATHS 对象定义');
}

const icons = [];
for (const prop of pathsNode.properties) {
  if (prop.type !== 'ObjectProperty') continue;
  if (prop.key.type !== 'Identifier') continue;
  const name = prop.key.name;
  const markup = jsxToMarkup(prop.value).trim();
  icons.push({ name, markup });
}

console.log(`解析到 ${icons.length} 个图标`);

// ---- 生成 SCSS ----
const lines = [];
lines.push('/* 自动生成，勿手改：由 scripts/gen-icons.cjs 从 Icon.tsx 转换而来 */');
lines.push('');
lines.push('.ic {');
lines.push('  display: inline-block;');
lines.push('  width: 20px;');
lines.push('  height: 20px;');
lines.push('  flex: none;');
lines.push('  vertical-align: middle;');
lines.push('  /* 关键：颜色继承父级 color，等价于 Web 版的 stroke="currentColor" */');
lines.push('  background-color: currentColor;');
lines.push('  -webkit-mask-repeat: no-repeat;');
lines.push('  -webkit-mask-position: center;');
lines.push('  -webkit-mask-size: contain;');
lines.push('  mask-repeat: no-repeat;');
lines.push('  mask-position: center;');
lines.push('  mask-size: contain;');
lines.push('}');
lines.push('');

let totalBytes = 0;
const meta = {};

for (const { name, markup } of icons) {
  const uri = toDataUri(toSvg(markup));
  meta[name] = { markup, uri };
  totalBytes += uri.length;
  lines.push(`.ic-${name} {`);
  lines.push(`  -webkit-mask-image: url("${uri}");`);
  lines.push(`  mask-image: url("${uri}");`);
  lines.push('}');
  lines.push('');
}

// TabBar 的「+」用了 strokeWidth 2.2，单独出一个加粗变体
const plus = icons.find((i) => i.name === 'plus');
if (plus) {
  const uri = toDataUri(toSvg(plus.markup, '2.2'));
  totalBytes += uri.length;
  lines.push('/* plus 的加粗变体：Web 版 TabBar 传了 strokeWidth={2.2} */');
  lines.push('.ic-plus--thick {');
  lines.push(`  -webkit-mask-image: url("${uri}");`);
  lines.push(`  mask-image: url("${uri}");`);
  lines.push('}');
  lines.push('');
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(meta, null, 2), 'utf8');

// 图标名清单：供 Icon 组件做「名字是否合法」判断，拼错时回退到 other，
// 与 Web 版行为一致（Web 版是 PATHS[name] ?? PATHS.other）
const NAMES = path.resolve(__dirname, '../src/components/icon-names.ts');
const namesContent =
  '/* 自动生成，勿手改：由 scripts/gen-icons.cjs 从 Icon.tsx 转换而来 */\n' +
  'export const ICON_NAMES = [\n  ' +
  icons.map((i) => `'${i.name}'`).join(',\n  ') +
  ',\n] as const;\n\n' +
  '/** 任意字符串也允许，但只有清单内的名字有真实图标 */\n' +
  'export type IconName = (typeof ICON_NAMES)[number] | (string & {});\n';
fs.mkdirSync(path.dirname(NAMES), { recursive: true });
fs.writeFileSync(NAMES, namesContent, 'utf8');

const scssSize = fs.statSync(OUT).size;
console.log(`已生成 ${OUT}`);
console.log(`  图标数      : ${icons.length}（+1 加粗变体）`);
console.log(`  data-uri 合计: ${(totalBytes / 1024).toFixed(1)} KB`);
console.log(`  scss 文件    : ${(scssSize / 1024).toFixed(1)} KB`);
console.log(`  平均单图标   : ${(totalBytes / icons.length).toFixed(0)} 字节`);
