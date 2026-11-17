/**
 * 新版本提示的调度。
 *
 * 背景：微信在小程序**每次启动（含热启动）**时检查更新，包下载完成即回调
 * `onUpdateReady`。这个时刻不可控，可能正好落在用户填「记一笔」的中途。
 * 记账表单的金额、分类、账户、时间、备注全是组件内 useState，只有点保存才
 * 进 store —— 此刻强制重启，等于整笔白填，而且没有任何提示。
 *
 * 所以分两步走：能弹就弹；不能弹（正在填表单 / 弹层打开）就记下来，
 * 等回到没有未提交内容的页面再弹。tab 页的 `useDidShow` 负责兜这个时机。
 */
import Taro, { getAccountInfoSync } from '@tarojs/taro'
import { flushPersist } from '@/store/useStore'
import { canPromptNow } from '@/utils/promptGate'
import { requestPreUpgradeBackup } from '@/utils/backupPrompt'

interface Manager {
  applyUpdate: () => void
  onUpdateReady: (cb: () => void) => void
  onUpdateFailed: (cb: () => void) => void
}

let manager: Manager | null = null

/** 有更新等着提示（当时被打断了） */
let pending = false

/**
 * 供验收脚本在真机/模拟器里核对：
 * `getCurrentPages()` 返回的 route 到底带不带前导斜杠，静态检查查不出来，
 * 猜错会让「记账页不弹」这条静默失效。暴露只读，release 不挂。
 */
export const __debugCanPrompt = canPromptNow
export const __debugPending = () => pending

function showRestartModal() {
  if (!manager) return
  Taro.showModal({
    title: '发现新版本',
    content: '新版本已下载完成，重启小程序即可使用。',
    confirmText: '立即重启',
    cancelText: '稍后',
  })
    .then((res) => {
      if (!res.confirm) return
      // applyUpdate() 会立刻重启，内存里未落盘的状态随之消失 → 先写掉防抖里那一笔。
      // storage 本身持久，重启后账本照旧；这里丢不起的是刚记完还没落盘的那条。
      try {
        flushPersist()
      } catch {
        /* 落盘失败也不能卡住更新 */
      }
      if (manager) manager.applyUpdate()
    })
    .catch(() => {
      /* 点遮罩关闭时个别基础库走 reject，属正常操作，忽略 */
    })
}

function askRestart() {
  if (!manager) return
  // 注册回调到真正弹窗之间，用户可能已经点进了记账页，这里再判一次
  if (!canPromptNow()) {
    pending = true
    return
  }
  pending = false
  // 先给一次备份机会。此刻新包已下载完但尚未应用，旧代码与 storage 都还在——
  // 这是唯一能赶在「版本切换」之前提醒的时机。等 applyUpdate() 一执行，
  // 新版本的迁移逻辑就会改写存量数据，那时再提醒已经晚了。
  // 弹层处理完（备份成功或用户跳过）会回调 showRestartModal，重启流程不会断。
  if (requestPreUpgradeBackup(showRestartModal)) return
  showRestartModal()
}

/** 启动时挂一次。重复调用无副作用。 */
export function setupUpdateManager() {
  try {
    // 开发者工具没有真实的新包可下，跳过以免弹窗挡住验收脚本
    if (getAccountInfoSync().miniProgram.envVersion === 'develop') return
    if (manager) return
    // 基础库 < 1.9.90 无此 API，退化成「退出重进」自然生效，不报错
    const mgr = Taro.getUpdateManager() as unknown as Manager
    if (!mgr) return
    manager = mgr
    mgr.onUpdateReady(askRestart)
    // 下载失败不打扰用户：下次冷启动会自动重试
    mgr.onUpdateFailed(() => {})
  } catch {
    /* 环境不支持就当没有这段，不影响启动 */
  }
}

/**
 * 由 tab 页的 `useDidShow` 调用：被打断的提示在这里补上。
 *
 * 只挂在 tab 页是有意的 —— 记账页等表单页不会成为「已经离开但还没弹」的位置，
 * 离开表单页必然落到某个 tab 页，时机由那里接住。
 *
 * 返回「本次是否真的去弹了」。备份提醒据此让位：两个提示同时弹会叠成两层遮罩，
 * 上面那层关掉才会露出下面那层，用户会以为点了没反应。
 */
export function flushPendingUpdatePrompt(): boolean {
  if (!pending) return false;
  askRestart();
  return true;
}
