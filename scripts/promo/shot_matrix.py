"""比较几种截帧参数，找最快的一档。"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import CDP, launch  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
EXE = os.path.join(ROOT, "src-tauri", "target", "release", "ferry-launcher.exe")
DATA = os.path.join(ROOT, "demo-profile")

CASES = [
    ("jpeg80", {"format": "jpeg", "quality": 80, "fromSurface": True}),
    ("jpeg80+fast", {"format": "jpeg", "quality": 80, "fromSurface": True, "optimizeForSpeed": True}),
    ("jpeg70+fast", {"format": "jpeg", "quality": 70, "fromSurface": True, "optimizeForSpeed": True}),
    ("png+fast", {"format": "png", "fromSurface": True, "optimizeForSpeed": True}),
    ("jpeg80-nosurf", {"format": "jpeg", "quality": 80, "fromSurface": False}),
]


def main():
    proc = launch(EXE, DATA)
    time.sleep(6)
    cdp = CDP()
    info = cdp.send("Browser.getWindowForTarget")
    cdp.send("Browser.setWindowBounds", {"windowId": info["windowId"], "bounds": {"width": 1600, "height": 941}})
    time.sleep(1.2)

    for name, params in CASES:
        n = 0
        total = 0
        start = time.monotonic()
        try:
            while time.monotonic() - start < 2.5:
                result = cdp.send("Page.captureScreenshot", params)
                total += len(result["data"])
                n += 1
        except Exception as error:
            print(f"{name}: 失败 {error}")
            continue
        span = time.monotonic() - start
        print(f"{name:14s} {n/span:5.1f} fps  {total//max(n,1)//1024:4d} KB/帧")

    cdp.close()
    proc.terminate()


if __name__ == "__main__":
    main()
