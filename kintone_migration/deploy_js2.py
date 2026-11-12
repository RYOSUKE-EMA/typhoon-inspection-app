# tenken.js と PDFライブラリを 台風・災害時・足場 の各アプリ（PC・スマホ）に登録してデプロイ
from kapi import ids, send, upload, deploy, HERE

files = [HERE / "lib" / "pdf-lib.min.js", HERE / "lib" / "fontkit.umd.min.js", HERE / "tenken.js"]


def keys():  # fileKeyは1回しか使えないので枠ごとにアップロード
    return [{"type": "FILE", "file": {"fileKey": upload(f, mime="text/javascript")}} for f in files]


for key in ("typhoon", "disaster", "scaffold"):
    app = ids()[key]
    send("PUT", "preview/app/customize.json", {"app": app, "scope": "ALL",
         "desktop": {"js": keys(), "css": []}, "mobile": {"js": keys(), "css": []}})
    deploy(app)
