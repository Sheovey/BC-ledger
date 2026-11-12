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

function withNotice(src, relFrom, time) {
  const note = `> ⚠️ 本文件是**镜像**，由 \`npm run docs\` 从 \`${relFrom}\` 生成（${time}）。请修改源文件后重新运行，不要直接编辑这里。`;
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
  const body = withNotice(src, from, time);
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
