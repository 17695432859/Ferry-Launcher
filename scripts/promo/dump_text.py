"""打印某一页的正文文本，确认列表是不是真的加载出来了。"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import CDP, launch  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
EXE = os.path.join(ROOT, "src-tauri", "target", "release", "ferry-launcher.exe")
DATA = os.path.join(ROOT, "demo-profile")


def click(cdp, x, y):
    cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y, "button": "none"})
    cdp.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1})
    cdp.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1})


def main():
    page = sys.argv[1] if len(sys.argv) > 1 else "下载"
    proc = launch(EXE, DATA)
    time.sleep(6)
    cdp = CDP()
    info = cdp.send("Browser.getWindowForTarget")
    cdp.send("Browser.setWindowBounds", {"windowId": info["windowId"], "bounds": {"width": 1600, "height": 941}})
    time.sleep(1.0)
    coords = {"启动": (84, 68), "账户": (84, 110), "下载": (84, 153), "联机": (84, 195), "设置": (84, 237)}
    click(cdp, *coords[page])
    time.sleep(4)
    print(cdp.js("document.body.innerText"))
    cdp.close()
    proc.terminate()


if __name__ == "__main__":
    main()
