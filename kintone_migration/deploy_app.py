# tenken_app.js（元の画面の再現）を登録。既定は準備用アプリ5835。本番切替時は --prod で app 5287 に登録する
import sys
from kapi import ids, get, send, upload, deploy, HERE

app = 5287 if "--prod" in sys.argv else ids()["spa"]
files = [HERE / "lib" / "pdf-lib.min.js", HERE / "lib" / "fontkit.umd.min.js", HERE / "tenken_app.js"]
k = lambda: [{"type": "FILE", "file": {"fileKey": upload(f, mime="text/javascript")}} for f in files]
scope = get("app/customize.json", app=app)["scope"]
send("PUT", "preview/app/customize.json", {"app": app, "scope": scope,
     "desktop": {"js": k(), "css": []}, "mobile": {"js": k(), "css": []}})
deploy(app)
