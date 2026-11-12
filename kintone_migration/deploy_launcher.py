# app 5287 のカスタマイズを入口メニュー（launcher.js）に差し替える
# 旧版（Vercel埋め込み）は ../kintone_customize/tenken_embed.js に残っている
from kapi import get, send, upload, deploy, HERE

APP = 5287
cur = get("app/customize.json", app=APP)
print("before:", [f["file"]["name"] for f in cur["desktop"]["js"] if f["type"] == "FILE"])
k = lambda: [{"type": "FILE", "file": {"fileKey": upload(HERE / "launcher.js", mime="text/javascript")}}]
send("PUT", "preview/app/customize.json", {"app": APP, "scope": cur["scope"],
     "desktop": {"js": k(), "css": []}, "mobile": {"js": k(), "css": []}})
deploy(APP)
