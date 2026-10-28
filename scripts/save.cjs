/**
 * 一条命令存档 —— 给「不想记 git 命令」的场景用。
 *
 *   npm run save     把当前全部改动存成一次快照
 *   npm run log      看最近 15 次
 *
 * 回退（按需选一种，第一条最常用）：
 *   git reset --hard HEAD~1                          退回上一次存档
 *                                                    ⚠ 会丢弃未存档的改动，先确认没有想留的东西
 *   git checkout <hash> -- src/pages/ledger/index.scss   只把某个文件取回某个版本
 *   git show <hash> --stat                           看某次改了哪些文件
 *   git diff <hash> HEAD -- src/                     看某个版本到现在的全部差异
 *
 * message 只用 ASCII 时间戳：Windows cmd 的默认代码页不是 UTF-8，
 * 中文 message 在 `git log` 里会变成乱码。
 */
const { execSync } = require('child_process');
const path = require('path');

const cwd = path.join(__dirname, '..');

const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd });
const capture = (cmd) => execSync(cmd, { encoding: 'utf8', cwd }).trim();

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
  now.getHours(),
)}:${pad(now.getMinutes())}`;

try {
  capture('git rev-parse --git-dir');
} catch (e) {
  console.error('这里还不是 git 仓库，先在项目根目录执行：git init -b main');
  process.exit(1);
}

run('git add -A');

const staged = capture('git diff --cached --name-only');
if (!staged) {
  console.log('\n没有改动，无需存档。');
  process.exit(0);
}

const files = staged.split('\n').length;
run(`git commit -m "save: ${stamp}"`);
console.log(`\n已存档 ${files} 个文件。最近 5 次：`);
run('git log --oneline --max-count=5');
