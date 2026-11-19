"""WebView2 不支持 Page.startScreencast，改成高频 Page.captureScreenshot 轮询。
先测一下能跑多少帧。"""
import base64
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import CDP, launch  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
EXE = os.path.join(ROOT, "src-tauri", "target", "release", "ferry-launcher.exe")
DATA = os.path.join(ROOT, "demo-profile")


def main():
    proc = launch(EXE, DATA)
    time.sleep(6)
    cdp = CDP()
    info = cdp.send("Browser.getWindowForTarget")
    cdp.send("Browser.setWindowBounds", {"windowId": info["windowId"], "bounds": {"width": 1600, "height": 941}})
    time.sleep(1.2)

    for quality in (80, 90):
        n = 0
        start = time.monotonic()
        total = 0
        while time.monotonic() - start < 3:
            result = cdp.send("Page.captureScreenshot", {"format": "jpeg", "quality": quality, "fromSurface": True})
            total += len(result["data"])
            n += 1
        span = time.monotonic() - start
        print(f"quality={quality}: {n} 帧 / {span:.2f}s = {n/span:.1f} fps, 平均 {total//n//1024} KB(base64)")

    cdp.close()
    proc.terminate()


if __name__ == "__main__":
    main()
