# kintone版の各アプリを「江間さんのみ」にする（準備中）。公開時は --public で app 5287 と同じ権限に戻す
import sys
from kapi import ids, get, send, deploy

ME = "c0114101"
apps = [ids()[k] for k in ("junpo", "junpo_conf", "tenken_conf", "typhoon", "disaster", "scaffold")]
if "--public" in sys.argv:
    rights = get("app/acl.json", app=5287)["rights"]
else:
    full = {k: True for k in ("appEditable", "recordViewable", "recordAddable", "recordEditable",
                              "recordDeletable", "recordImportable", "recordExportable")}
    rights = [{"entity": {"type": "USER", "code": ME}, "includeSubs": False, **full}]
for app in apps:
    send("PUT", "preview/app/acl.json", {"app": app, "rights": rights})
    deploy(app)
