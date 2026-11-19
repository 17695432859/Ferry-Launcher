"""确认视口尺寸/缩放，决定坐标基准。"""
import base64
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import CDP, launch  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
EXE = os.path.join(ROOT, "src-tauri", "target", "release", "ferry-launcher.exe")
DATA = os.path.join(ROOT, "demo-profile")


def png_size(data):
    raw = base64.b64decode(data)
    return int.from_bytes(raw[16:20], "big"), int.from_bytes(raw[20:24], "big")


def main():
    proc = launch(EXE, DATA)
    time.sleep(6.5)
    cdp = CDP()
    print("初始 inner/DPR:", cdp.js("JSON.stringify([innerWidth, innerHeight, devicePixelRatio])"))
    info = cdp.send("Browser.getWindowForTarget")
    print("window bounds:", info.get("bounds"))
    cdp.send("Browser.setWindowBounds", {"windowId": info["windowId"], "bounds": {"width": 1600, "height": 941}})
    time.sleep(1.5)
    print("resize 后:", cdp.js("JSON.stringify([innerWidth, innerHeight, devicePixelRatio])"))
    result = cdp.send("Page.captureScreenshot", {"format": "png"})
    print("截图尺寸:", png_size(result["data"]))

    # 用 emulation 强制 1600x941
    cdp.send("Emulation.setDeviceMetricsOverride",
             {"width": 1600, "height": 941, "deviceScaleFactor": 1, "mobile": False})
    time.sleep(0.8)
    print("emulation 后:", cdp.js("JSON.stringify([innerWidth, innerHeight, devicePixelRatio])"))
    result = cdp.send("Page.captureScreenshot", {"format": "png"})
    print("emulation 截图尺寸:", png_size(result["data"]))
    cdp.close()
    proc.terminate()


if __name__ == "__main__":
    main()
