"""宣传片的「演出脚本」：按时间轴驱动真实界面。

所有输入都走 CDP 的 Input.dispatchMouseEvent，在页面内部派发，
不会碰到系统鼠标，也不会把点击落到用户正在用的窗口上。

用法：
    python scripts/promo/driver.py            # 按时间轴演出，同时打点
    python scripts/promo/driver.py --dry      # 只跑交互，不录（验证坐标）
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import CDP, launch  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
EXE = os.path.join(ROOT, "src-tauri", "target", "release", "ferry-launcher.exe")
DATA = os.path.join(ROOT, "demo-profile")
MARKS = os.path.join(ROOT, "promo", "marks.json")

W, H = 1600, 900

# 坐标全部按 1600x941 的视口量出来
NAV = {"启动": (84, 68), "账户": (84, 110), "下载": (84, 153), "联机": (84, 195), "设置": (84, 237)}
# 每个页面独有的文案，用来确认点击真的切过去了
NAV_MARK = {
    "启动": "导入已有目录",
    "账户": "添加账户",
    "下载": "版本安装",
    "联机": "和队友进同一个房间",
    "设置": "外观与启动行为",
}
CARD = [(325, 177), (325, 249), (325, 321), (325, 393)]
TAB = {"概览": (526, 140), "内容": (580, 140), "版本设置": (647, 140)}
PLAY = (1512, 83)
ROLE = [(476, 191), (563, 191), (663, 191)]
NET_TAB = {"陶瓦联机": (1435, 87), "EasyTier": (1525, 87)}
SET_THEME = {"深色": (1081, 175), "浅色": (1126, 175), "跟随系统": (1184, 175)}
SET_ACCENT = {"Azure": (1013, 225), "Mint": (1045, 225), "Violet": (1077, 225),
              "Amber": (1109, 225), "Rose": (1141, 225), "Cyan": (1173, 225)}
SET_BLUR = (1072, 269)
SET_SCALE = (1072, 310)
SET_SOURCE = {"官方": (1091, 580), "BMCLAPI": (1166, 580)}
DL_FILTER = {"正式版": (963, 133), "快照": (1013, 133), "全部": (1057, 133)}
DL_LOADER = {"原版": (1142, 165), "Fabric": (1192, 165), "Forge": (1247, 165),
             "NeoForge": (1312, 165), "Quilt": (1143, 197)}
DL_INSTALL = (1254, 373)
MOD_LIST = (760, 500)


class Show:
    def __init__(self, cdp, dry=False):
        self.cdp = cdp
        self.dry = dry
        self.t0 = None
        self.marks = []
        self.cursor = (900, 500)

    # ---- 基础动作 -------------------------------------------------------
    def _mouse(self, kind, x, y, button="none", click_count=1):
        payload = {"type": kind, "x": x, "y": y, "button": button, "clickCount": click_count}
        if kind == "mouseWheel":
            payload = {"type": kind, "x": x, "y": y, "deltaX": 0, "deltaY": click_count}
        self.cdp.send("Input.dispatchMouseEvent", payload)

    def move(self, x, y, duration=0.45, steps=None):
        """带缓动的鼠标移动，hover 倾斜才会自然。"""
        sx, sy = self.cursor
        steps = steps or max(6, int(duration * 60))
        for index in range(1, steps + 1):
            p = index / steps
            ease = 1 - (1 - p) ** 3  # easeOutCubic
            self._mouse("mouseMoved", sx + (x - sx) * ease, sy + (y - sy) * ease)
            time.sleep(duration / steps)
        self.cursor = (x, y)

    def click(self, x, y, settle=0.12):
        self.move(x, y, duration=0.28)
        self._mouse("mousePressed", x, y, "left")
        time.sleep(0.06)
        self._mouse("mouseReleased", x, y, "left")
        time.sleep(settle)

    def press_hold(self, x, y, hold=0.35):
        """只按下不松开，展示按钮 0.97 的按下反馈，又不会真的触发启动。"""
        self.move(x, y, duration=0.4)
        self._mouse("mousePressed", x, y, "left")
        time.sleep(hold)
        self._mouse("mouseReleased", x, y, "left")
        time.sleep(0.1)

    def wheel(self, x, y, total, duration=1.6, steps=26):
        for index in range(steps):
            self._mouse("mouseWheel", x, y, click_count=total / steps)
            time.sleep(duration / steps)

    def mark(self, label):
        if self.t0 is None:
            return
        self.marks.append({"t": round(time.monotonic() - self.t0, 3), "label": label})
        if os.environ.get("PROMO_SHOTS"):
            import base64

            result = self.cdp.send("Page.captureScreenshot", {"format": "jpeg", "quality": 80})
            path = os.path.join(ROOT, "promo", "dry", f"{label}.jpg")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as handle:
                handle.write(base64.b64decode(result["data"]))

    def wait(self, seconds):
        time.sleep(seconds)

    def text(self):
        return self.cdp.js("document.body.innerText") or ""

    def nav(self, name, tries=3):
        """点侧边栏，并确认页面真的切过去了——点空一次整段素材就废了。"""
        marker = NAV_MARK[name]
        for _ in range(tries):
            self.click(*NAV[name])
            time.sleep(0.35)
            if marker in self.text():
                return True
        print(f"警告：{name} 页面没切过去")
        return False

    def wait_text(self, needle, timeout=6.0):
        """等某段文字出现。版本清单是联网拉的，偶尔要等一会儿才出来。"""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if needle in self.text():
                return True
            time.sleep(0.3)
        return False

    def until(self, seconds):
        if self.t0 is None:
            return
        remain = seconds - (time.monotonic() - self.t0)
        if remain > 0:
            time.sleep(remain)


def build(show):
    """时间轴。每一段都先用 until() 对齐绝对时间，避免动作累积误差。"""
    show.until(1.0)
    show.mark("intro")

    # —— 实例列表：划过四张卡片，3D 倾斜 ——
    show.until(4.6)
    show.mark("cards")
    for index, (x, y) in enumerate(CARD):
        show.until(4.6 + index * 1.15)
        show.move(x, y, duration=0.7)
    show.until(9.4)
    show.click(*CARD[1])          # 选中第二个实例
    show.until(11.2)
    show.click(*CARD[2])
    show.until(13.0)
    show.click(*CARD[0])

    # —— 内容：mod 列表 ——
    show.until(15.0)
    show.mark("content")
    show.click(*TAB["内容"])
    show.until(17.4)
    show.wheel(*MOD_LIST, total=520, duration=2.2)
    show.until(20.6)
    show.wheel(*MOD_LIST, total=380, duration=1.6)
    show.until(22.8)
    show.mark("content-end")

    # —— 概览 ——
    show.until(23.4)
    show.click(*TAB["概览"])
    show.until(25.6)

    # —— 账户：多角色 ——
    show.until(26.0)
    show.mark("accounts")
    show.nav("账户")
    show.until(28.8)
    show.click(*ROLE[1])
    show.until(31.0)
    show.click(*ROLE[2])
    show.until(33.0)

    # —— 联机 ——
    show.until(33.2)
    show.mark("netplay")
    show.nav("联机")
    show.until(35.4)
    show.click(*NET_TAB["陶瓦联机"])
    show.until(37.8)
    show.click(*NET_TAB["EasyTier"])
    show.until(39.6)

    # —— 设置：主题、强调色、模糊、缩放 ——
    show.until(39.8)
    show.mark("settings")
    show.nav("设置")
    show.until(42.0)
    show.click(*SET_ACCENT["Mint"])
    show.until(43.8)
    show.click(*SET_ACCENT["Violet"])
    show.until(45.6)
    show.click(*SET_THEME["浅色"])
    show.until(48.2)
    show.click(*SET_THEME["深色"])
    show.until(50.0)
    show.click(*SET_ACCENT["Azure"])
    show.until(51.6)
    show.mark("settings-end")

    # —— 下载：版本列表 + 加载器 ——
    show.until(52.0)
    show.mark("download")
    show.nav("下载")
    # 版本清单来自 BMCLAPI，偶尔会慢或拉空；空的话重进一次页面再等。
    # 注意不能只搜 "1.21.1"——启动页的实例列表里也有这串字。
    for _ in range(3):
        if show.wait_text("版本安装", timeout=2.0) and show.wait_text("1.21.1", timeout=6.0):
            break
        show.nav("启动")
        show.nav("下载")
    show.until(55.4)
    show.wheel(520, 300, total=700, duration=1.8)
    show.until(57.6)
    show.click(*DL_LOADER["Forge"])
    show.until(59.4)
    show.mark("download-end")

    # —— 回到启动页收尾 ——
    show.until(59.8)
    show.mark("finale")
    show.nav("启动")
    show.until(61.6)
    show.move(*CARD[0], duration=0.8)
    show.until(63.4)
    show.press_hold(*PLAY, hold=0.5)
    show.until(65.2)
    show.mark("end")


def pre_roll(cdp):
    """开录前把界面摆回起始状态。

    主题是持久化的，上一次录制如果把界面留在浅色，这一次整片都会是浅色，
    所以每次开录前都显式点回深色 + 启动页。
    """
    show = Show(cdp)
    show.nav("设置")
    show.click(*SET_THEME["深色"])
    time.sleep(0.5)
    show.nav("启动")
    show.move(900, 520, duration=0.2)
    time.sleep(0.4)


def main():
    dry = "--dry" in sys.argv
    proc = launch(EXE, DATA)
    time.sleep(6.5)
    cdp = CDP()
    info = cdp.send("Browser.getWindowForTarget")
    cdp.send("Browser.setWindowBounds", {"windowId": info["windowId"],
                                         "bounds": {"width": W, "height": H}})
    time.sleep(1.5)
    cdp.js("document.documentElement.style.scrollBehavior='auto'")
    show = Show(cdp, dry)
    show.cursor = (900, 520)
    show.t0 = time.monotonic()
    try:
        build(show)
    finally:
        with open(MARKS, "w", encoding="utf-8") as handle:
            json.dump({"started_at": show.t0, "marks": show.marks}, handle, ensure_ascii=False, indent=2)
        print("打点:", json.dumps(show.marks, ensure_ascii=False))
        cdp.close()
        time.sleep(0.3)
        proc.terminate()


if __name__ == "__main__":
    main()
