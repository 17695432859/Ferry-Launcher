"""Windows 原生窗口截图（纯 ctypes，不依赖 Pillow）。

用法:
  py scripts/shot.py start            启动 Tauri 版（已运行则复用）
  py scripts/shot.py capture out.png  截取 Ferry Launcher 窗口
  py scripts/shot.py kill             结束进程
"""
import ctypes
import ctypes.wintypes as wt
import os
import struct
import subprocess
import sys
import time
import zlib
from pathlib import Path

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32

# 必须声明 DPI 感知，否则 125% 缩放下拿到的窗口矩形是虚拟化坐标，截出来会被裁掉
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        user32.SetProcessDPIAware()
    except Exception:
        pass

SRCCOPY = 0x00CC0020
DIB_RGB_COLORS = 0
BI_RGB = 0
TITLE = "Ferry Launcher"
ROOT = Path(__file__).resolve().parent.parent
EXE = Path(os.environ.get("FERRY_EXE") or ROOT / "src-tauri" / "target" / "release" / "ferry-launcher.exe")


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", wt.DWORD),
        ("biWidth", wt.LONG),
        ("biHeight", wt.LONG),
        ("biPlanes", wt.WORD),
        ("biBitCount", wt.WORD),
        ("biCompression", wt.DWORD),
        ("biSizeImage", wt.DWORD),
        ("biXPelsPerMeter", wt.LONG),
        ("biYPelsPerMeter", wt.LONG),
        ("biClrUsed", wt.DWORD),
        ("biClrImportant", wt.DWORD),
    ]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wt.DWORD * 3)]


def our_pids():
    """启动器进程的 PID 集合，用来把同名的浏览器窗口排除掉"""
    pids = set()
    for name in ("ferry-launcher.exe", "FerryLauncher-0.1.0.exe"):
        out = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {name}", "/FO", "CSV", "/NH"],
            capture_output=True, text=True, errors="ignore",
        ).stdout
        for line in out.splitlines():
            parts = [p.strip('"') for p in line.split('","')]
            if len(parts) >= 2 and parts[0].lower() == name.lower():
                try:
                    pids.add(int(parts[1]))
                except ValueError:
                    pass
    return pids


def find_window():
    pids = our_pids()
    found = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def enum_proc(h, _):
        if not user32.IsWindowVisible(h):
            return True
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(h, ctypes.byref(pid))
        if pid.value not in pids:
            return True
        length = user32.GetWindowTextLengthW(h)
        if length:
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(h, buf, length + 1)
            if buf.value.strip() == TITLE:
                rect = wt.RECT()
                user32.GetClientRect(h, ctypes.byref(rect))
                found.append((rect.right * rect.bottom, h))
        return True

    user32.EnumWindows(enum_proc, 0)
    # 同进程可能还有隐藏的宿主窗口，取客户区最大的那个才是主窗口
    found.sort(reverse=True)
    return found[0][1] if found else 0


def grab(hwnd, rect):
    left, top, right, bottom = rect
    width, height = right - left, bottom - top
    screen_dc = user32.GetDC(0)
    mem_dc = gdi32.CreateCompatibleDC(screen_dc)
    bitmap = gdi32.CreateCompatibleBitmap(screen_dc, width, height)
    gdi32.SelectObject(mem_dc, bitmap)
    # PrintWindow 抓的是窗口自己的绘制内容，窗口被别的程序挡住也能截对
    if not user32.PrintWindow(hwnd, mem_dc, 2):  # PW_RENDERFULLCONTENT
        gdi32.BitBlt(mem_dc, 0, 0, width, height, screen_dc, left, top, SRCCOPY)

    info = BITMAPINFO()
    info.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    info.bmiHeader.biWidth = width
    info.bmiHeader.biHeight = -height  # 负数 = 自上而下
    info.bmiHeader.biPlanes = 1
    info.bmiHeader.biBitCount = 32
    info.bmiHeader.biCompression = BI_RGB

    buffer = ctypes.create_string_buffer(width * height * 4)
    gdi32.GetDIBits(mem_dc, bitmap, 0, height, buffer, ctypes.byref(info), DIB_RGB_COLORS)
    gdi32.DeleteObject(bitmap)
    gdi32.DeleteDC(mem_dc)
    user32.ReleaseDC(0, screen_dc)
    return width, height, buffer.raw


def encode_png(width, height, raw):
    rows = bytearray()
    stride = width * 4
    for y in range(height):
        rows.append(0)
        line = raw[y * stride:(y + 1) * stride]
        # BGRA -> RGB
        rgb = bytearray(stride // 4 * 3)
        rgb[0::3] = line[2::4]
        rgb[1::3] = line[1::4]
        rgb[2::3] = line[0::4]
        rows += rgb

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(rows), 6))
        + chunk(b"IEND", b"")
    )


def alive():
    names = ("ferry-launcher.exe", "ferrylauncher-0.1.0.exe")
    for name in names:
        out = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {name}", "/NH"],
            capture_output=True, text=True, errors="ignore",
        ).stdout
        if name in out.lower():
            return True
    return False


def start():
    if alive():
        print("已在运行")
        return 0
    if not EXE.exists():
        print(f"找不到 {EXE}")
        return 1
    # 清掉代理变量：从带代理的终端里拉起来的进程会继承 *_PROXY，
    # reqwest 默认会走它，截图里的下载失败其实是被代理拦了
    env = {k: v for k, v in os.environ.items() if not k.lower().endswith("_proxy")}
    env.pop("NO_PROXY", None)
    subprocess.Popen([str(EXE)], cwd=str(EXE.parent), env=env,
                     creationflags=0x00000008 | 0x00000200)  # DETACHED_PROCESS|NEW_PROCESS_GROUP
    for _ in range(40):
        time.sleep(0.5)
        if find_window():
            time.sleep(1.5)  # 等首帧动画
            print("已启动")
            return 0
    print("窗口未出现")
    return 1


def capture(target):
    hwnd = find_window()
    if hwnd:
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        user32.SetForegroundWindow(hwnd)
        time.sleep(0.4)
    if not hwnd:
        print("没找到窗口")
        return 1
    rect = wt.RECT()
    user32.GetClientRect(hwnd, ctypes.byref(rect))
    origin = wt.POINT(0, 0)
    user32.ClientToScreen(hwnd, ctypes.byref(origin))
    box = (origin.x, origin.y, origin.x + rect.right, origin.y + rect.bottom)
    width, height, raw = grab(hwnd, box)
    Path(target).parent.mkdir(parents=True, exist_ok=True)
    Path(target).write_bytes(encode_png(width, height, raw))
    print(f"已保存 {target} {width}x{height}")
    return 0


def kill():
    for name in ("ferry-launcher.exe", "FerryLauncher-0.1.0.exe"):
        subprocess.run(["taskkill", "/F", "/IM", name], capture_output=True)
    print("已结束")
    return 0


def click(x, y):
    """在窗口客户区坐标 (x, y) 上点一下，用来做交互冒烟测试"""
    hwnd = find_window()
    if not hwnd:
        print("没找到窗口")
        return 1
    # 用户可能正在用电脑：先把我们的窗口顶到前台，确认它真的是前台窗口再发输入，
    # 否则鼠标事件会落到别人的窗口上（曾经误点过用户的浏览器）。
    user32.ShowWindow(hwnd, 9)
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.35)
    if user32.GetForegroundWindow() != hwnd:
        print("窗口不在前台，已放弃这次点击（不打扰用户）")
        return 2
    origin = wt.POINT(0, 0)
    user32.ClientToScreen(hwnd, ctypes.byref(origin))
    sx, sy = origin.x + x, origin.y + y
    user32.SetCursorPos(sx, sy)
    time.sleep(0.15)

    # WebView2 对老式 mouse_event 不太买账，用 SendInput 走真实输入通道
    class MOUSEINPUT(ctypes.Structure):
        _fields_ = [
            ("dx", wt.LONG),
            ("dy", wt.LONG),
            ("mouseData", wt.DWORD),
            ("dwFlags", wt.DWORD),
            ("time", wt.DWORD),
            ("dwExtraInfo", ctypes.POINTER(wt.ULONG)),
        ]

    class INPUT(ctypes.Structure):
        class _U(ctypes.Union):
            _fields_ = [("mi", MOUSEINPUT)]

        _anonymous_ = ("u",)
        _fields_ = [("type", wt.DWORD), ("u", _U)]

    def send(flags):
        item = INPUT(type=0, mi=MOUSEINPUT(0, 0, 0, flags, 0, None))
        user32.SendInput(1, ctypes.byref(item), ctypes.sizeof(INPUT))

    send(0x0002)  # LEFTDOWN
    time.sleep(0.08)
    send(0x0004)  # LEFTUP
    time.sleep(0.6)
    print(f"已点击 ({x}, {y}) -> 屏幕 ({sx}, {sy})")
    return 0


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "capture"
    if action == "start":
        sys.exit(start())
    if action == "kill":
        sys.exit(kill())
    if action == "click":
        sys.exit(click(int(sys.argv[2]), int(sys.argv[3])))
    target = sys.argv[2] if len(sys.argv) > 2 else str(ROOT / "shots" / "tauri.png")
    sys.exit(capture(target))
