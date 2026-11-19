"""再试一次 PrintWindow：窗口被遮挡时能不能拿到新鲜画面、能跑多少帧。"""
import ctypes
import ctypes.wintypes as wt
import hashlib
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import CDP, launch  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
EXE = os.path.join(ROOT, "src-tauri", "target", "release", "ferry-launcher.exe")
DATA = os.path.join(ROOT, "demo-profile")

u = ctypes.windll.user32
g = ctypes.windll.gdi32
u.SetProcessDPIAware()


def find_hwnd(pid):
    found = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def callback(hwnd, _):
        owner = wt.DWORD()
        u.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid and u.IsWindowVisible(hwnd):
            rect = wt.RECT()
            u.GetClientRect(hwnd, ctypes.byref(rect))
            if rect.right > 600 and rect.bottom > 400:
                found.append((hwnd, rect.right * rect.bottom))
        return True

    u.EnumWindows(callback, 0)
    return max(found, key=lambda p: p[1])[0] if found else 0


def grab(hwnd, width, height, flags=0x2):
    dc = u.GetDC(hwnd)
    mem = g.CreateCompatibleDC(dc)
    bitmap = g.CreateCompatibleBitmap(dc, width, height)
    g.SelectObject(mem, bitmap)
    ok = u.PrintWindow(hwnd, mem, flags)
    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [("biSize", wt.DWORD), ("biWidth", wt.LONG), ("biHeight", wt.LONG),
                    ("biPlanes", wt.WORD), ("biBitCount", wt.WORD), ("biCompression", wt.DWORD),
                    ("biSizeImage", wt.DWORD), ("biXPelsPerMeter", wt.LONG), ("biYPelsPerMeter", wt.LONG),
                    ("biClrUsed", wt.DWORD), ("biClrImportant", wt.DWORD)]
    header = BITMAPINFOHEADER()
    header.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    header.biWidth = width
    header.biHeight = -height
    header.biPlanes = 1
    header.biBitCount = 32
    buffer = ctypes.create_string_buffer(width * height * 4)
    g.GetDIBits(mem, bitmap, 0, height, buffer, ctypes.byref(header), 0)
    g.DeleteObject(bitmap)
    g.DeleteDC(mem)
    u.ReleaseDC(hwnd, dc)
    return ok, buffer.raw


def main():
    proc = launch(EXE, DATA)
    time.sleep(6.5)
    cdp = CDP()
    info = cdp.send("Browser.getWindowForTarget")
    cdp.send("Browser.setWindowBounds", {"windowId": info["windowId"], "bounds": {"width": 1600, "height": 941}})
    time.sleep(1.5)
    print("viewport", cdp.js("JSON.stringify([innerWidth, innerHeight, devicePixelRatio])"))

    hwnd = find_hwnd(proc.pid)
    print("hwnd", hwnd)
    rect = wt.RECT()
    u.GetClientRect(hwnd, ctypes.byref(rect))
    width, height = rect.right, rect.bottom
    print("client", width, height)

    # 1) 静止时是否稳定
    hashes = []
    for _ in range(3):
        _, raw = grab(hwnd, width, height)
        hashes.append(hashlib.md5(raw).hexdigest()[:8])
        time.sleep(0.4)
    print("静止 3 帧:", hashes)

    # 2) 制造动画后看是否在变
    start = time.monotonic()
    hashes = []
    n = 0
    while time.monotonic() - start < 3:
        t = time.monotonic() - start
        cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved",
                                             "x": 400 + int(300 * t / 3), "y": 177, "button": "none"})
        ok, raw = grab(hwnd, width, height)
        hashes.append(hashlib.md5(raw).hexdigest()[:6])
        n += 1
    span = time.monotonic() - start
    print(f"PrintWindow: {n/span:.1f} fps, 不同帧数 {len(set(hashes))}/{n}")
    print("样例:", hashes[:12])
    cdp.close()
    proc.terminate()


if __name__ == "__main__":
    main()
