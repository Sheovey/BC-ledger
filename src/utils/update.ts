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
import { useUiStore } from '@/store/ui'

/**
 * 整页都是未提交表单的路由。目前只有记账页；
 * 以后新增「编辑资料」这类整页表单，把路由加进来即可。
 */
const FORM_ROUTES = ['pages/record/index']

interface Manager {
  applyUpdate: () => void
  onUpdateReady: (cb: () => void) => void
  onUpdateFailed: (cb: () => void) => void
}

let manager: Manager | null = null

/** 有更新等着提示（当时被打断了） */
let pending = false

function currentRoute(): string {
  try {
    const pages = Taro.getCurrentPages() as unknown as Array<{ route?: string }>
    const cur = pages[pages.length - 1]
    return (cur && cur.route) || ''
  } catch {
    return ''
  }
}

/**
 * 此刻弹窗会不会打断正在填的东西。
 *
 * 判据只有两条，都是「下面压着未提交内容」的场景：
 *   1. 有 Sheet / 确认框打开 —— 分类多选、时间设置、账本切换都在这里，
 *      关掉弹层即丢失所选，被强插一个弹窗同样难受；
 *   2. 停在记账页 —— 整页表单都在内存里。
 *
 * 其余页面（首页、流水、图表、我的）都是只读展示，随时可以弹。
 */
function canPromptNow(): boolean {
  if (useUiStore.getState().sheetDepth > 0) return false
  const route = currentRoute()
  if (!route) return true
  return !FORM_ROUTES.some((r) => route.indexOf(r) === 0)
}

/**
 * 供验收脚本在真机/模拟器里核对：
 * `getCurrentPages()` 返回的 route 到底带不带前导斜杠，静态检查查不出来，
 * 猜错会让「记账页不弹」这条静默失效。暴露只读，release 不挂。
 */
export const __debugCanPrompt = canPromptNow
export const __debugPending = () => pending

function askRestart() {
  if (!manager) return
  // 注册回调到真正弹窗之间，用户可能已经点进了记账页，这里再判一次
  if (!canPromptNow()) {
    pending = true
    return
  }
  pending = false
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
 */
export function flushPendingUpdatePrompt() {
  if (!pending) return
  askRestart()
}
