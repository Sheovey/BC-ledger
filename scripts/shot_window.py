"""截取微信开发者工具窗口（Windows）。

用法：
    python scripts/shot_window.py                      # 截整个窗口
    python scripts/shot_window.py --crop               # 只裁模拟器手机屏并放大
    python scripts/shot_window.py --out preview/x.png  # 指定输出
    python scripts/shot_window.py --crop --scale 2.4   # 指定放大倍数

为什么要 EnumWindows 而不是 FindWindow：
FindWindow 按标题精确匹配，开发者工具在打开项目、切换模拟器、或者被最小化到
托盘之后，主窗口标题并不总是项目名，FindWindow 会返回 0 —— 此时 GetWindowRect
拿到 (0,0,0,0)，ImageGrab 就会退化成抓整个屏幕，截出来是别的窗口（踩过）。
"""
import argparse
import ctypes
import sys
import time
from ctypes import wintypes

from PIL import Image, ImageGrab

user32 = ctypes.windll.user32

# 让本进程 DPI 感知，避免逻辑像素与物理像素不一致导致裁剪偏移
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    user32.SetProcessDPIAware()

WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

# 模拟器手机屏在窗口内的相对位置（窗口被强制摆成 1500x940 之后实测）
# 仅作为自动检测失败时的兜底：不同次启动、不同模拟器缩放都会让它漂，
# 正常路径用 detect_phone_box() 自动量。
PHONE_BOX = (532, 60, 846, 800)


def detect_phone_box(img):
    """在窗口截图里定位模拟器手机屏。

    注意：不能假设手机屏在窗口的某个固定位置。开发者工具会记住上次的
    面板布局，模拟器可能在左、在中、也能被拖到右侧（实测从左侧变到了中间，
    直接导致按固定坐标裁出来的图只剩半屏）。

    也不能用「所有浅色像素的包围盒」：标题栏、工具栏、浅色主题面板本身
    也是浅色，包围盒会退化成整个窗口（实测得到 1492x877）。

    可靠做法是两遍扫描，都用「亮度阈值 + 最长连续段」：
    1. 横向：按列平均亮度找出最宽的连续亮列段 → 屏幕左右边界。
    2. 纵向：在刚才那段的中点列上按行亮度找最长的连续亮行段 → 上下边界。
    用平均值而不是单像素，是为了跨过屏幕内的深色文字、图标和大色块。

    返回 None 表示定位失败，调用方用兜底坐标。
    """
    w, h = img.size
    px = img.convert('L').load()
    THRESHOLD = 170

    def longest_run(values):
        best = None
        start = None
        for index, value in enumerate(values):
            if value > THRESHOLD:
                if start is None:
                    start = index
            elif start is not None:
                if best is None or (index - start) > (best[1] - best[0]):
                    best = (start, index)
                start = None
        if start is not None:
            if best is None or (len(values) - start) > (best[1] - best[0]):
                best = (start, len(values))
        return best

    # ---- 1. 横向：列平均亮度 ----
    y_lo = int(h * 0.15)
    y_hi = int(h * 0.85)
    y_step = max(1, (y_hi - y_lo) // 40)
    col_avg = []
    for x in range(w):
        total = 0
        count = 0
        for y in range(y_lo, y_hi, y_step):
            total += px[x, y]
            count += 1
        col_avg.append(total / count if count else 0)
    col_run = longest_run(col_avg)
    if not col_run:
        return None
    left, right = col_run
    if (right - left) < w * 0.1:
        return None

    # ---- 2. 纵向：屏幕中线的行亮度 ----
    x_mid = (left + right) // 2
    row_avg = []
    for y in range(h):
        total = 0
        count = 0
        for x in range(left + 2, right - 2, max(1, (right - left) // 40)):
            total += px[x, y]
            count += 1
        row_avg.append(total / count if count else 0)
    row_run = longest_run(row_avg)
    if not row_run:
        return None
    top, bottom = row_run
    if (bottom - top) < h * 0.4:
        return None

    return (left, top, right, bottom)


def collect(keywords):
    found = []

    def _cb(hwnd, _lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        n = user32.GetWindowTextLengthW(hwnd)
        if n == 0:
            return True
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        title = buf.value
        if any(k in title for k in keywords):
            rect = wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(rect))
            found.append((hwnd, title, rect))
        return True

    user32.EnumWindows(WNDENUMPROC(_cb), 0)
    return found


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=r'F:\02-Ours\06-Gadgets\01-Ledger\ledger-taro\preview\weapp-window.png')
    parser.add_argument('--crop', action='store_true', help='只输出模拟器手机屏')
    parser.add_argument('--scale', type=float, default=2.4, help='手机屏放大倍数（仅 --crop 时生效）')
    parser.add_argument('--size', default='1500x940', help='把窗口摆成这个尺寸，保证裁剪坐标稳定')
    parser.add_argument(
        '--allow-fallback',
        action='store_true',
        help='自动定位失败时仍用兜底坐标出图（仅调试用，裁出来可能是半屏）',
    )
    args = parser.parse_args()

    found = collect(('微信开发者工具', 'WeChat', 'wechat', 'ledger-taro'))
    if not found:
        print('未找到开发者工具窗口（可能被最小化到托盘或标题不同）')
        return 1

    # 逐个恢复再测量。
    # 不能直接按「当前面积」排序：窗口最小化时 GetWindowRect 拿到的是
    # -32000 附近的坐标和一个无意义的尺寸（实测 160x28），恢复之后才有意义。
    #
    # 用 ShowWindowAsync 而不是 ShowWindow：对已经最小化的窗口，
    # 同步版 ShowWindow(SW_RESTORE) 会返回 1 但窗口纹丝不动（实测一直 iconic），
    # 异步版才会真正投递恢复消息。
    SW_RESTORE = 9
    best = None
    for hwnd, title, _rect in found:
        user32.ShowWindowAsync(hwnd, SW_RESTORE)
        time.sleep(0.5)
        r = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(r))
        area = (r.right - r.left) * (r.bottom - r.top)
        if best is None or area > best[0]:
            best = (area, hwnd, title, r)

    if best is None:
        print('候选窗口都无法恢复')
        return 1
    _area, hwnd, title, rect = best
    print(f'选定窗口: {title}')

    user32.SetForegroundWindow(hwnd)
    # 摆到固定位置与尺寸：后面裁手机屏用的相对坐标依赖这个尺寸
    w, h = (int(v) for v in args.size.lower().split('x'))
    user32.MoveWindow(hwnd, 60, 40, w, h, True)

    # SetForegroundWindow 经常被系统拒绝（后台进程无权抢前台），
    # 结果 ImageGrab 抓到的 bbox 区域是被别的窗口盖住的画面 ——
    # 截出来是一屏终端日志，非常误导。临时置顶才能保证拿到自己的像素。
    SWP_NOSIZE = 0x0001
    SWP_NOMOVE = 0x0002
    SWP_SHOWWINDOW = 0x0040
    HWND_TOPMOST = -1
    HWND_NOTOPMOST = -2
    user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_SHOWWINDOW)
    time.sleep(1.5)
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.6)

    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    win_w = rect.right - rect.left
    win_h = rect.bottom - rect.top
    if win_w < 400 or win_h < 300:
        print(f'窗口尺寸异常 {win_w}x{win_h}，可能仍在最小化')
        return 1

    img = ImageGrab.grab(bbox=(rect.left, rect.top, rect.right, rect.bottom))
    print(f'窗口: {title}  {win_w}x{win_h} @ ({rect.left},{rect.top})')

    if args.crop and detect_phone_box(img) is None:
        # 模拟器在 reLaunch 后、或者窗口刚被置顶时可能还在重绘，
        # 抓到的是一屏空白。等一会儿再抓一次，别急着判死。
        print('首帧没找到模拟器画面，1.2s 后重试…')
        time.sleep(1.2)
        user32.SetForegroundWindow(hwnd)
        img = ImageGrab.grab(bbox=(rect.left, rect.top, rect.right, rect.bottom))

    if args.crop:
        box = detect_phone_box(img)
        if box:
            print(f'自动定位手机屏: {box[2] - box[0]}x{box[3] - box[1]} @ ({box[0]},{box[1]})')
        elif args.allow_fallback:
            box = (
                min(PHONE_BOX[0], win_w),
                min(PHONE_BOX[1], win_h),
                min(PHONE_BOX[2], win_w),
                min(PHONE_BOX[3], win_h),
            )
            print(f'自动定位失败，用兜底坐标: {box}')
        else:
            # 宁可不出图也不要出错的图：兜底坐标在不同面板布局下会裁成半屏，
            # 拿去核对排版会得出完全错误的结论。
            print('自动定位手机屏失败：窗口里没找到模拟器画面。')
            print('可能原因：模拟器面板被关掉了、项目没编译、或窗口被别的程序遮挡。')
            print('先跑一次 node scripts/shot_window.py 看全窗口图，或确认 cli.bat auto 还在跑。')
            user32.SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE)
            return 2
        # 边缘留 2px，避免把手机屏的边框线切掉
        left = max(0, box[0] - 2)
        top = max(0, box[1] - 2)
        right = min(win_w, box[2] + 2)
        bottom = min(win_h, box[3] + 2)
        img = img.crop((left, top, right, bottom))
        if args.scale != 1:
            img = img.resize((int(img.width * args.scale), int(img.height * args.scale)), Image.LANCZOS)

    # 截完就取消置顶，别把窗口永远压在最前面
    user32.SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE)

    img.save(args.out)
    print(f'已保存: {args.out}  {img.size[0]}x{img.size[1]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
