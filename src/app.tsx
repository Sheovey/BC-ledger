import type { PropsWithChildren } from 'react'
import Taro, { getAccountInfoSync, useDidHide, useLaunch } from '@tarojs/taro'
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

// 新版本提示。
//
// 微信只在小程序**冷启动**时检查更新，包下载完成后要「重启小程序」才生效；
// 切后台 30 分钟内再回来属于热启动，内存里还是旧代码，永远换不到新包。
// 1.1.5 之前没接这段，用户只能靠「杀掉微信再进一次」碰到新版本，而且不知道
// 要退几次。这里在包下载完成时主动问一句，点确认立刻重启。
//
// 两个必须守住的细节：
//   1. applyUpdate() 会立刻重启，内存里未落盘的状态随之消失 → 先 flushPersist()。
//      storage 本身是持久的，重启后账本照旧，丢的只有 250ms 防抖窗口里那一笔。
//   2. 弹窗期间用户可能正在输入，所以**不自动重启**，只给「立即重启 / 稍后」。
//      选「稍后」不会丢更新，下次冷启动会再问一次。
function setupUpdateManager() {
  try {
    // 开发者工具里没有真实的新版本可下，跳过以免弹窗挡住验收脚本
    if (getAccountInfoSync().miniProgram.envVersion === 'develop') return
    // 基础库 < 1.9.90 没有该 API，此时退回「退出重进」自然生效，不报错
    const mgr = Taro.getUpdateManager()
    if (!mgr) return

    mgr.onUpdateReady(() => {
      Taro.showModal({
        title: '发现新版本',
        content: '新版本已下载完成，重启小程序即可使用。',
        confirmText: '立即重启',
        cancelText: '稍后',
      })
        .then((res) => {
          if (!res.confirm) return
          try {
            flushPersist()
          } catch {
            /* 落盘失败也不能卡住更新 */
          }
          mgr.applyUpdate()
        })
        .catch(() => {
          /* 点遮罩关闭时个别基础库走 reject，属正常操作，忽略 */
        })
    })

    // 下载失败不打扰用户：下次冷启动会自动重试
    mgr.onUpdateFailed(() => {})
  } catch {
    /* 环境不支持就当没有这段，不影响启动 */
  }
}

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
