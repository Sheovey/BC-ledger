/**
 * 上传开发版本的一条命令搞定。
 *
 * 为什么需要它：版本号散在三个地方（`package.json` 的 version、`settings/index.tsx`
 * 的 APP_VERSION、`upload -v` 的参数），彼此没有自动关联，手打一次就多一次漏改的
 * 机会——漏了的表现是「界面显示旧版本」，而且只有翻到「我的」页才看得见。
 * 这里把唯一的来源定成 `package.json`，上传参数从它取值，不再手打。
 *
 * 版本号策略（2026-11-04 老板定）：**未提审/未发布前，一批改动共用一个版本号**。
 * 所以本脚本不 bump 版本号，只读——改号是「开一批新改动」时才做一次的事。
 *
 * 备注（-d）自动拼成 `<版本号> · <日期> · <git 短 sha> · <你写的说明>`。
 * 为什么要带 sha：同号可能传好几次，后台列表里只有备注能区分这批的哪一版是哪一版，
 * 而 sha 是唯一且能直接 `git show` 回溯的那一项。
 *
 * 用法：
 *   npm run upload -- "记一笔金额光标修正"
 *   npm run upload                # 说明留空，备注只剩 版本号 · 日期 · sha
 *   npm run upload -- --dry-run "说明"   # 只校验并打印将要执行的命令，不真上传
 *
 * 前置：`build:weapp` 已经跑过（本脚本不会替你构建，因为构建要 3~4 分钟，
 * 混在一条命令里失败时分不清是构建挂了还是上传挂了）。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;

// 界面里显示的版本号必须与 package.json 一致，否则「我的」页会显示旧版本
const settingsSrc = fs.readFileSync(path.join(root, 'src/pages/settings/index.tsx'), 'utf8');
const shown = (settingsSrc.match(/const APP_VERSION = '([^']+)'/) || [])[1];
if (shown !== version) {
  console.error(`✗ 版本号不一致：package.json = ${version}，界面 APP_VERSION = ${shown ?? '(没找到)'}`);
  console.error(`  先把 src/pages/settings/index.tsx 的 APP_VERSION 改成 ${version} 再上传。`);
  process.exit(1);
}

if (!fs.existsSync(path.join(root, 'dist/app.json'))) {
  console.error('✗ dist/app.json 不存在，先跑 npm run build:weapp');
  process.exit(1);
}

const sha = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' });
const shortSha = (sha.stdout || '').trim() || 'nogit';
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

const note = argv.filter((a) => a !== '--dry-run').join(' ').trim();
const desc = [version, date, shortSha, note].filter(Boolean).join(' · ');

if (dryRun) {
  console.log('（dry-run，不执行上传）');
  console.log(`版本号：${version}（取自 package.json，与界面一致）`);
  console.log(`备注：  ${desc}`);
  console.log(`命令：  node scripts/wxcli.cjs upload -v ${version} -d "${desc}"`);
  process.exit(0);
}

// 冷启动会卡在 initialize 后被 SIGTERM，先用 islogin 把进程预热起来
console.log('[1/2] 预热登录态（cli upload 冷启动会卡死）…');
const login = spawnSync(process.execPath, ['scripts/wxcli.cjs', 'islogin'], { cwd: root, stdio: 'inherit' });
if (login.status !== 0) {
  console.error('✗ islogin 失败，检查开发者工具是否已登录');
  process.exit(1);
}

console.log(`[2/2] 上传 ${desc}`);
// 注意这里多包了一层引号：wxcli.cjs 用 spawnSync(..., { shell: true }) 调 .bat，
// Node 在 shell 模式下只是把参数用空格拼起来、不逐个加引号，
// 于是「1.1.5 · 2026-11-06 · 3f5a189 · 说明」会被 cmd 按空格拆成 4 个参数，
// 真正落到 -d 上的只有第一个词「1.1.5」（实测：传 ['-d','1.1.5 x y'] 收到的是
// ["-d","1.1.5","x","y"]；写成 ['-d','"1.1.5 x y"'] 才是 ["-d","1.1.5 x y"]）。
const up = spawnSync(process.execPath, ['scripts/wxcli.cjs', 'upload', '-v', version, '-d', `"${desc}"`], {
  cwd: root,
  stdio: 'inherit',
});
if (up.status !== 0) {
  console.error('✗ 上传失败');
  process.exit(up.status === null ? 1 : up.status);
}

console.log('');
console.log(`✓ 已上传开发版本 ${version}（备注：${desc}）`);
console.log('  下一步：后台「版本管理 → 开发版本」确认体积 → 设为体验版 →（要发就）提审。');
console.log('  提审那一刻这个号就锁定了，之后任何改动都要换号（审核区单槽位，同名会分不清）。');
