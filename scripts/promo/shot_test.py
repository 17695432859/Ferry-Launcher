"""窗口被遮挡时还能不能拿到新画面？动画还在不在走？"""
import base64
import hashlib
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import CDP, launch  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
EXE = os.path.join(ROOT, "src-tauri", "target", "release", "ferry-launcher.exe")
DATA = os.path.join(ROOT, "demo-profile")


def shot(cdp):
    result = cdp.send("Page.captureScreenshot", {"format": "jpeg", "quality": 85, "fromSurface": True})
    data = base64.b64decode(result["data"])
    return hashlib.md5(data).hexdigest()[:10], len(data)


def main():
    proc = launch(EXE, DATA)
    time.sleep(6)
    cdp = CDP()
    info = cdp.send("Browser.getWindowForTarget")
    cdp.send("Browser.setWindowBounds", {"windowId": info["windowId"], "bounds": {"width": 1600, "height": 941}})
    time.sleep(1.2)

    print("静置 3 次（每 1.2s）：", [shot(cdp)[0] for _ in range(3)])

    # 动一下鼠标，看 hover 动画是否推进
    cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": 325, "y": 249, "button": "none"})
    time.sleep(0.4)
    hashes = []
    for _ in range(4):
        hashes.append(shot(cdp)[0])
        time.sleep(0.25)
    print("hover 后连续 4 帧：", hashes)

    # 换页
    cdp.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": 84, "y": 110, "button": "left", "clickCount": 1})
    cdp.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": 84, "y": 110, "button": "left", "clickCount": 1})
    time.sleep(1.0)
    print("点击账户后：", shot(cdp))
    cdp.close()
    proc.terminate()


if __name__ == "__main__":
    main()
