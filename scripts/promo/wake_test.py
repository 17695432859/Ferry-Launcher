"""诊断：页面是不是被判成 hidden，能不能用 CDP 强制唤醒。"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import CDP, Recorder, launch  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
EXE = os.path.join(ROOT, "src-tauri", "target", "release", "ferry-launcher.exe")
DATA = os.path.join(ROOT, "demo-profile")


def main():
    proc = launch(EXE, DATA)
    time.sleep(6)
    cdp = CDP()
    info = cdp.send("Browser.getWindowForTarget")
    cdp.send("Browser.setWindowBounds", {"windowId": info["windowId"], "bounds": {"width": 1600, "height": 941}})
    time.sleep(1.0)

    print("visibilityState =", cdp.js("document.visibilityState"), "| hidden =", cdp.js("document.hidden"))
    print("hasFocus =", cdp.js("document.hasFocus()"))

    # 强制唤醒
    try:
        cdp.send("Page.setWebLifecycleState", {"state": "active"})
        print("setWebLifecycleState ok")
    except Exception as error:
        print("setWebLifecycleState 失败", error)
    try:
        cdp.send("Emulation.setFocusEmulationEnabled", {"enabled": True})
        print("setFocusEmulationEnabled ok")
    except Exception as error:
        print("setFocusEmulationEnabled 失败", error)
    time.sleep(0.5)
    print("唤醒后 visibilityState =", cdp.js("document.visibilityState"), "| focus =", cdp.js("document.hasFocus()"))

    # 用 rAF 计数判断动画是否在跑
    cdp.js("window.__raf = 0; (function loop(){ window.__raf++; requestAnimationFrame(loop); })()")
    time.sleep(2.0)
    print("2 秒内 rAF 次数 =", cdp.js("window.__raf"))

    rec = Recorder(cdp, os.path.join(ROOT, "promo", "frames-test2"))
    rec.start()
    time.sleep(1.0)
    start = time.monotonic()
    while time.monotonic() - start < 5:
        t = time.monotonic() - start
        cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved",
                                             "x": 400 + int(300 * t / 5), "y": 177, "button": "none"})
        time.sleep(0.016)
    rec.stop()
    frames = rec.frames
    span = frames[-1][0] - frames[0][0] if len(frames) > 1 else 0
    print(f"screencast 帧数 {len(frames)} 跨度 {span:.2f}s → {len(frames)/max(span,0.001):.1f} fps")
    cdp.close()
    proc.terminate()


if __name__ == "__main__":
    main()
