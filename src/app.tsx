import type { PropsWithChildren } from 'react'
import { getAccountInfoSync, useDidHide, useLaunch } from '@tarojs/taro'
import { flushPersist, setPersistHook, useStore } from '@/store/useStore'
import { useUiStore } from '@/store/ui'
import {
  archiveDirPath,
  archiveNow,
  archiveOnHide,
  archiveStatus,
  clearArchives,
  getArchiveFilePath,
  initArchive,
  latestArchive,
  listArchives,
  readArchiveJson,
  scheduleArchive,
  setArchiveBudget,
  writeBookXlsx,
  writeSnapshotJson,
} from '@/db/archive'
import { setupUpdateManager, __debugCanPrompt, __debugPending } from '@/utils/update'
import {
  evaluateBackupPrompt,
  forceBackupPrompt,
  requestBackupPrompt,
  requestPreUpgradeBackup,
  resetUpgradeCache,
  willBlockBeforeUpgrade,
  __afterPromptRuns,
} from '@/utils/backupPrompt'
import { hasOnboarded, markOnboarded, resetOnboarded, shouldAutoShow } from '@/utils/onboard'
import { APP_VERSION } from '@/config/version'
import './app.scss'

// 调试钩子：把 store 与存档 API 挂到全局，自动化脚本（scripts/*.cjs）靠它在
// 小程序逻辑层直接调 action，验证「写入 → 落盘 → 重启后读回」整条链路。
//
// 正式版（release）不挂。用户环境里既没有调试器也够不到 globalThis，
// 挂上去没有任何好处，只是把自己留的后门带进线上包。开发版与体验版保留，
// 12 套验收脚本在这两种环境下照常工作。
//
// 注意不能用 NODE_ENV 判断：taro build 默认就是 production，整段会被编译掉，
// 验收体系随之失效。这里按小程序自身的环境标识判断。
function exposeDebugHooks() {
  try {
    if (getAccountInfoSync().miniProgram.envVersion === 'release') return
  } catch {
    /* 取不到版本信息时按开发版处理：宁可多挂，也不能让验收静默失效 */
  }
  const g = globalThis as unknown as Record<string, unknown>
  g.__ledgerStore = useStore
  g.__ledgerArchive = {
    archiveNow,
    archiveOnHide,
    archiveStatus,
    clearArchives,
    getArchiveFilePath,
    latestArchive,
    listArchives,
    readArchiveJson,
    scheduleArchive,
    setArchiveBudget,
    writeBookXlsx,
    writeSnapshotJson,
    archiveDirPath,
  }
  // 更新提示的判定是纯函数但依赖当前路由，静态检查查不出 route 格式是否对得上
  g.__ledgerUpdate = { canPromptNow: __debugCanPrompt, isPending: __debugPending }
  // 弹层计数：残留会让自定义 tabBar 永久隐藏（底部导航整条消失），
  // 这个值只有读得到才能验，所以一并挂出来
  g.__ledgerUi = useUiStore
  // 备份提醒：判定逻辑是纯函数，但依赖 storage 里的时间戳与条数，
  // 只有能在逻辑层直接调用，验收才能覆盖「该弹 / 不该弹」的分支。
  // forcePrompt 供 UI 验证用（develop 环境默认不自动弹，会挡住其他脚本的点击）。
  g.__ledgerBackup = {
    evaluate: evaluateBackupPrompt,
    request: requestBackupPrompt,
    forcePrompt: forceBackupPrompt,
    resetUpgrade: resetUpgradeCache,
    // 升级前拦截：判据与真实链路共用一份，验收测的就是实际跑的那条
    preUpgradeProbe: willBlockBeforeUpgrade,
    preUpgrade: () => requestPreUpgradeBackup(() => {}),
    afterRuns: __afterPromptRuns,
    // 验收脚本靠它构造「已是最新版本」的前置条件。
    // 不能硬编码版本号——bump 一次，"不等于当前版本"就成立，升级分支会被误触发。
    currentVersion: APP_VERSION,
  }
  // 首次引导：不暴露重置就只能清整个 storage 才能再看一次，
  // 而清 storage 会连账本一起清掉，验收里代价太大。
  g.__ledgerGuide = {
    isDone: hasOnboarded,
    canAutoShow: shouldAutoShow,
    mark: markOnboarded,
    reset: resetOnboarded,
  }
}

exposeDebugHooks()

// 数据源注入必须在任何一次落盘之前完成，放模块顶层最稳。
// archive.ts 刻意不 import useStore，就是为了避免 useStore → persist → archive
// 这条反向依赖，这里用闭包把 getState 递进去。
initArchive({ getData: () => useStore.getState().data })

function App({ children }: PropsWithChildren) {
  useLaunch(() => {
    // 生命周期里任何异常都会变成冷启动白屏，比丢功能严重得多，一律兜住
    try {
      setPersistHook(() => scheduleArchive('persist'))
      // 首屏渲染后再补一次存档：覆盖「上次没存完就被系统杀了」的情况
      setTimeout(() => {
        try {
          scheduleArchive('launch')
        } catch {
          /* 存档失败不影响启动 */
        }
      }, 3000)
      setupUpdateManager()
    } catch {
      /* 忽略 */
    }
  })

  useDidHide(() => {
    try {
      // 先把 250ms 防抖里的那笔写掉，再落一份 JSON 快照。
      // 这里刻意不生成 Excel：切后台没有可执行时长承诺，大库拼接可能上百毫秒。
      flushPersist()
      archiveOnHide()
    } catch {
      /* 忽略 */
    }
  })

  return children
}

export default App
