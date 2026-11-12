# junpo.js と PDFライブラリを安全旬報アプリ（PC・スマホ両方）に登録してデプロイ
from kapi import ids, send, upload, deploy, HERE

app = ids()["junpo"]
files = [HERE / "lib" / "pdf-lib.min.js", HERE / "lib" / "fontkit.umd.min.js", HERE / "junpo.js"]


def keys():  # fileKeyは1回しか使えないので枠ごとにアップロード
    return [{"type": "FILE", "file": {"fileKey": upload(f, mime="text/javascript")}} for f in files]


send("PUT", "preview/app/customize.json", {"app": app, "scope": "ALL",
     "desktop": {"js": keys(), "css": []}, "mobile": {"js": keys(), "css": []}})
deploy(app)
