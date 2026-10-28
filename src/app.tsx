import type { PropsWithChildren } from 'react'
import { getAccountInfoSync, useDidHide, useLaunch } from '@tarojs/taro'
import { flushPersist, setPersistHook, useStore } from '@/store/useStore'
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
