/**
 * 把项目级文档镜像进仓库 docs/，随代码一起提交到 GitHub。
 *
 * 为什么需要：`小程序项目档案.md` 与 `.workbuddy/memory/MEMORY.md` 都在
 * `01-Ledger/` 根目录，而 git 仓库在 `ledger-taro/` 子目录 —— 两份文档此前
 * 没有任何版本控制，也没有远端备份，本机磁盘坏了就等于全部丢失。
 *
 * 约定：**根目录那两份是权威源，docs/ 下的是只读镜像**。
 * 改完源文件跑一次 `npm run docs`，镜像顶部会自动写入来源与生成时间。
 *
 * 不采用符号链接：Windows + git 下软链会被存成 blob，克隆到别的机器上
 * 可能变成普通文件或直接失败，交付链路不可靠。
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const PROJECT = path.join(REPO, '..');
const OUT = path.join(REPO, 'docs');

const PAIRS = [
  { from: '小程序项目档案.md', to: '项目档案.md' },
  { from: '.workbuddy/memory/MEMORY.md', to: '助手记忆.md' },
];

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 镜像脱敏。docs/ 会推到公开仓库，源文件里的 AppID 与本机绝对路径只留在本地。
 *
 * 为什么不直接改源文件：助手需要真实路径与 AppID 才能干活（打开项目、核对后台），
 * 公开副本不需要。所以只在复制这一步做替换，源文件一个字符都不动。
 *
 * 加新规则时注意别误伤 markdown 链接与 URL：只匹配「单字母盘符 + 冒号 + 分隔符」。
 */
const REDACT = [
  [/wx[0-9a-f]{16}/g, '<AppID>'],
  // 盘符路径的两条约束缺一不可：
  //   ① `(?<![A-Za-z0-9])` —— 盘符前不能是字母数字，否则 `https://` 里的 `s:/`
  //      会被当成「盘符 s + 路径」，整条 URL 被替换成 `http<本机路径>`；
  //   ② `(?!\/)` + 路径体至少 2 字符 —— 否则说明文字里单独出现的 `s:/` 也会中招，
  //      把一句技术说明改成语义不通的残句。
  [/(?<![A-Za-z0-9])[A-Za-z]:[\\/](?!\/)[^\s`"')）,，;；]{2,}/g, '<本机路径>'],
];

function redact(src) {
  return REDACT.reduce((acc, [re, to]) => acc.replace(re, to), src);
}

function withNotice(src, relFrom, time) {
  const note = `> ⚠️ 本文件是**镜像**，由 \`npm run docs\` 从 \`${relFrom}\` 生成（${time}），并已脱敏（AppID 与本机绝对路径替换为占位符）。请修改源文件后重新运行，不要直接编辑这里。`;
  const lines = src.split(/\r?\n/);
  const h1 = lines.findIndex((l) => l.startsWith('# '));
  if (h1 === -1) return `${note}\n\n${src}`;
  return [...lines.slice(0, h1 + 1), '', note, ...lines.slice(h1 + 1)].join('\n');
}

fs.mkdirSync(OUT, { recursive: true });
const time = stamp();
let failed = 0;

for (const { from, to } of PAIRS) {
  const srcPath = path.join(PROJECT, from);
  if (!fs.existsSync(srcPath)) {
    console.error(`✗ 源文件不存在：${from}`);
    failed++;
    continue;
  }
  const src = fs.readFileSync(srcPath, 'utf8');
  const body = withNotice(redact(src), from, time);
  const dest = path.join(OUT, to);
  fs.writeFileSync(dest, body, 'utf8');
  console.log(
    `√ ${to.padEnd(12)} ← ${from}  (${Buffer.byteLength(body)} 字节)`,
  );
}

if (failed) {
  console.error(`\n${failed} 个文件未同步，请检查上面的路径。`);
  process.exit(1);
}

console.log('\n镜像已更新，提交： git add docs && git commit -m "docs: 同步项目档案"');
