"""真实屏幕截图：把窗口顶到前台后直接 BitBlt 屏幕像素。

和 shot.py 的 PrintWindow 不同，这里抓到的是合成器最终输出的画面，
backdrop-filter（毛玻璃模糊）等 GPU 合成效果才是真实所见。

用法: py scripts/screen.py out.png
"""
import ctypes
import sys
import time

import shot
from shot import BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, SRCCOPY, encode_png, find_window, gdi32, user32
import ctypes.wintypes as wt

CAPTUREBLT = 0x40000000


def main(target: str) -> int:
    hwnd = find_window()
    if not hwnd:
        print("没找到窗口")
        return 1
    user32.ShowWindow(hwnd, 9)
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.8)

    rect = wt.RECT()
    user32.GetClientRect(hwnd, ctypes.byref(rect))
    origin = wt.POINT(0, 0)
    user32.ClientToScreen(hwnd, ctypes.byref(origin))
    width, height = rect.right, rect.bottom
    left, top = origin.x, origin.y

    screen_dc = user32.GetDC(0)
    mem_dc = gdi32.CreateCompatibleDC(screen_dc)
    bitmap = gdi32.CreateCompatibleBitmap(screen_dc, width, height)
    gdi32.SelectObject(mem_dc, bitmap)
    gdi32.BitBlt(mem_dc, 0, 0, width, height, screen_dc, left, top, SRCCOPY | CAPTUREBLT)

    info = BITMAPINFO()
    info.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    info.bmiHeader.biWidth = width
    info.bmiHeader.biHeight = -height
    info.bmiHeader.biPlanes = 1
    info.bmiHeader.biBitCount = 32
    info.bmiHeader.biCompression = 0

    buffer = ctypes.create_string_buffer(width * height * 4)
    gdi32.GetDIBits(mem_dc, bitmap, 0, height, buffer, ctypes.byref(info), DIB_RGB_COLORS)
    gdi32.DeleteObject(bitmap)
    gdi32.DeleteDC(mem_dc)
    user32.ReleaseDC(0, screen_dc)

    with open(target, "wb") as fh:
        fh.write(encode_png(width, height, buffer.raw))
    print(f"已保存 {target} {width}x{height}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "shots/screen.png"))
