/**
 * 微信开发者工具 CLI 的薄包装。
 *
 * 为什么需要它：Windows 下 npm script 直接调 .bat 容易踩路径与转义问题，
 * 而且每次手打 `"D:/WeChatDevTools/cli.bat" <cmd> --project "F:\...\ledger-taro"`
 * 太啰嗦。这里统一补上 --project 与 --lang，装在哪都能通过环境变量覆盖。
 *
 * 用法：
 *   npm run ide              打开开发者工具并载入本项目
 *   npm run auto             开启自动化端口 9420（跑验收脚本前必须先开）
 *   node scripts/wxcli.cjs <任意 cli 子命令> [原样透传的参数]
 *
 * 覆盖安装路径：set WECHAT_DEVTOOLS_CLI=D:\别的路径\cli.bat
 */
const { spawnSync } = require('child_process');
const path = require('path');

const CLI = process.env.WECHAT_DEVTOOLS_CLI || 'D:/WeChatDevTools/cli.bat';
const project = path.resolve(__dirname, '..');

// 这些子命令都需要知道「操作哪个项目」；--project 已显式给出时不重复追加
const PROJECT_COMMANDS = new Set([
  'open',
  'close',
  'preview',
  'auto-preview',
  'upload',
  'auto',
  'auto-replay',
  'build-npm',
]);

const [command, ...rest] = process.argv.slice(2);
if (!command) {
  console.error('用法：node scripts/wxcli.cjs <子命令> [参数]');
  console.error('例：node scripts/wxcli.cjs open    /    node scripts/wxcli.cjs auto --auto-port 9420');
  process.exit(1);
}

const args = [command, ...rest];
if (PROJECT_COMMANDS.has(command) && !args.includes('--project')) {
  args.push('--project', project);
}
if (!args.includes('--lang')) {
  args.push('--lang', 'zh');
}

console.log(`> "${CLI}" ${args.join(' ')}`);
// shell: true —— Windows 下 .bat 必须经 cmd 执行，否则 ENOENT
const result = spawnSync(CLI, args, { stdio: 'inherit', shell: true });
process.exit(result.status === null ? 1 : result.status);
