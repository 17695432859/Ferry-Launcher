"""正式开录：窗口临时置顶 → ffmpeg 30fps 抓真实画面 → 跑演出脚本 → 收工恢复。

窗口置顶是为了让 DWM 真的把它合成出来（被别的窗口挡住时 Windows 不会合成，
抓屏只会抓到挡住它的那个窗口）。录完立刻取消置顶。
"""
import ctypes
import ctypes.wintypes as wt
import json
import os
import subprocess
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import CDP, launch  # noqa: E402
from driver import DATA, EXE, ROOT, Show, build, pre_roll  # noqa: E402

u = ctypes.windll.user32
u.SetProcessDPIAware()
# 必须声明参数类型：不声明的话 HWND_TOPMOST(-1) 这种特殊句柄会被当成 32 位整数截断，
# SetWindowPos 静默返回成功但根本没生效（踩过一次）。
u.SetWindowPos.argtypes = [wt.HWND, wt.HWND, ctypes.c_int, ctypes.c_int,
                           ctypes.c_int, ctypes.c_int, wt.UINT]
u.SetWindowPos.restype = wt.BOOL
u.GetWindowLongW.argtypes = [wt.HWND, ctypes.c_int]
u.GetWindowLongW.restype = ctypes.c_long
u.GetWindowRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
u.GetClientRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
u.ClientToScreen.argtypes = [wt.HWND, ctypes.POINTER(wt.POINT)]
u.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
u.GetTopWindow.argtypes = [wt.HWND]
u.GetTopWindow.restype = wt.HWND
u.GetWindow.argtypes = [wt.HWND, wt.UINT]
u.GetWindow.restype = wt.HWND
u.IsWindowVisible.argtypes = [wt.HWND]
u.IsIconic.argtypes = [wt.HWND]

FFMPEG = r"C:\tools\ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe"
W, H = 1600, 900
WIN_X, WIN_Y = 140, 60
OUT = os.path.join(ROOT, "promo", "take.mp4")
MARKS = os.path.join(ROOT, "promo", "marks.json")

SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOZORDER = 0x0004
SWP_NOACTIVATE = 0x0010
HWND_TOPMOST = -1
HWND_NOTOPMOST = -2


def find_hwnd(pid):
    found = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def callback(hwnd, _):
        owner = wt.DWORD()
        u.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid and u.IsWindowVisible(hwnd):
            rect = wt.RECT()
            u.GetClientRect(hwnd, ctypes.byref(rect))
            if rect.right > 800 and rect.bottom > 500:
                found.append((hwnd, rect.right * rect.bottom))
        return True

    u.EnumWindows(callback, 0)
    return max(found, key=lambda pair: pair[1])[0] if found else 0


def client_screen_rect(hwnd):
    rect = wt.RECT()
    u.GetClientRect(hwnd, ctypes.byref(rect))
    origin = wt.POINT(0, 0)
    u.ClientToScreen(hwnd, ctypes.byref(origin))
    return origin.x, origin.y, rect.right, rect.bottom


def set_topmost(hwnd, on):
    target = wt.HWND(HWND_TOPMOST if on else HWND_NOTOPMOST)
    u.SetWindowPos(wt.HWND(hwnd), target, 0, 0, 0, 0,
                   SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)


GW_HWNDNEXT = 2


def _window_rect(hwnd):
    rect = wt.RECT()
    u.GetWindowRect(hwnd, ctypes.byref(rect))
    return rect.left, rect.top, rect.right, rect.bottom


def _overlaps(a, b):
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])


def who_covers(hwnd, rect):
    """沿 z 序从上往下找：在我们的窗口之前，有没有别的可见窗口压在上面。

    这一步是安全闸：抓屏抓的是屏幕像素，窗口一旦被挡住，录进去的就是用户的桌面。
    """
    title = ctypes.create_unicode_buffer(256)
    current = u.GetTopWindow(None)
    while current:
        if current == hwnd:
            return None
        if u.IsWindowVisible(current) and not u.IsIconic(current):
            other = _window_rect(current)
            if _overlaps(other, rect) and (other[2] - other[0]) > 8 and (other[3] - other[1]) > 8:
                u.GetWindowTextW(current, title, 256)
                name = title.value or f"<hwnd {current}>"
                # 桌面 / 任务栏之类的系统窗口不算遮挡
                if name not in ("Program Manager", "Shell_TrayWnd", ""):
                    return name
        current = u.GetWindow(current, GW_HWNDNEXT)
    return None


def fit_client(hwnd, want_w, want_h, x=WIN_X, y=WIN_Y):
    """把窗口摆到指定位置，并让客户区正好是 want_w × want_h。

    无边框窗口仍有几个像素的隐形边框，所以先量一次差值再修正。
    """
    u.SetWindowPos(wt.HWND(hwnd), wt.HWND(0), x, y, want_w, want_h, SWP_NOZORDER | SWP_NOACTIVATE)
    time.sleep(0.6)
    _, _, got_w, got_h = client_screen_rect(hwnd)
    outer_w = want_w + (want_w - got_w)
    outer_h = want_h + (want_h - got_h)
    u.SetWindowPos(wt.HWND(hwnd), wt.HWND(0), x, y, outer_w, outer_h, SWP_NOZORDER | SWP_NOACTIVATE)
    time.sleep(0.6)
    return client_screen_rect(hwnd)


def main():
    proc = launch(EXE, DATA)
    time.sleep(6.5)
    cdp = CDP()

    hwnd = find_hwnd(proc.pid)
    if not hwnd:
        print("找不到窗口")
        return 1
    left, top, width, height = fit_client(hwnd, W, H)
    print(f"客户区 {width}x{height} @ ({left},{top})")
    viewport = cdp.js("JSON.stringify([innerWidth, innerHeight, devicePixelRatio])")
    print("视口:", viewport)
    if (width, height) != (W, H):
        print("客户区没调准，放弃本次录制")
        proc.terminate()
        return 1

    set_topmost(hwnd, True)
    time.sleep(0.8)

    # 开录之前必须确认窗口真的露在最上面，否则抓到的就是别人的窗口
    client_rect = (left, top, left + width, top + height)
    cover = who_covers(hwnd, client_rect)
    for attempt in range(4):
        if not cover:
            break
        print(f"窗口被「{cover}」挡住，重新置顶（第 {attempt + 1} 次）")
        u.BringWindowToTop(hwnd)
        set_topmost(hwnd, True)
        time.sleep(1.2)
        cover = who_covers(hwnd, client_rect)
    if cover:
        print(f"仍然被「{cover}」挡住，放弃录制（不会录别人的屏幕）")
        set_topmost(hwnd, False)
        cdp.close()
        proc.terminate()
        return 2
    print("窗口确认在最上层")

    # 录制期间盯住窗口位置：窗口一旦被拖走，抓屏区域就和画面对不上了。
    pinned = {"stop": False, "moved": 0}

    def watchdog():
        while not pinned["stop"]:
            left_now, top_now, width_now, height_now = client_screen_rect(hwnd)
            if (left_now, top_now) != (left, top) or (width_now, height_now) != (width, height):
                pinned["moved"] += 1
                u.SetWindowPos(wt.HWND(hwnd), wt.HWND(HWND_TOPMOST), left - (width - width_now) // 2,
                               top - (height - height_now) // 2, width, height,
                               SWP_NOACTIVATE)
            time.sleep(0.25)

    watcher = threading.Thread(target=watchdog, daemon=True)
    watcher.start()

    # 抓客户区，隐藏系统光标（CDP 的输入不经过系统鼠标，留个静止光标很难看）
    command = [
        FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
        "-f", "gdigrab", "-framerate", "30",
        "-offset_x", str(left), "-offset_y", str(top),
        "-video_size", f"{width}x{height}", "-draw_mouse", "0",
        "-i", "desktop",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "16",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        OUT,
    ]
    pre_roll(cdp)

    print("开始录制…")
    started = time.monotonic()
    recorder = subprocess.Popen(command, stdin=subprocess.PIPE,
                                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    time.sleep(1.4)  # 等编码器真正开始

    show = Show(cdp)
    show.cursor = (900, 520)
    show.t0 = time.monotonic()
    # 录像是从 ffmpeg 启动那刻算起的，演出是从 t0 算起的，两者差一段
    # 剪辑时必须把这截空头剪掉，否则字幕会整体提前
    offset = show.t0 - started
    try:
        build(show)
    except Exception as error:
        print("演出中断:", error)
    finally:
        time.sleep(0.4)
        try:
            recorder.communicate(b"q", timeout=30)
        except Exception:
            recorder.kill()
        pinned["stop"] = True
        set_topmost(hwnd, False)
        with open(MARKS, "w", encoding="utf-8") as handle:
            json.dump({"started_at": show.t0, "offset": round(offset, 3),
                       "marks": show.marks}, handle,
                      ensure_ascii=False, indent=2)
        print("打点:", json.dumps(show.marks, ensure_ascii=False))
        print("录制期间窗口被移动次数:", pinned["moved"], "| 片头空转", round(offset, 2), "秒")
        cdp.close()
        proc.terminate()

    size = os.path.getsize(OUT) / 1024 / 1024 if os.path.exists(OUT) else 0
    print(f"输出 {OUT} {size:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
