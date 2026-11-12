# 工事番号のルックアップを外す（元のアプリと同じく、工事名は入力したまま残す）。移行済みの工事名は旧アプリの値に戻す。
from kapi import ids, get, send, deploy

src = {r["report_id"]["value"]: r["project_name"]["value"] for r in
       get("records.json", app=5287, query="limit 500", fields=["report_id", "project_name"])["records"]}
for key in ("junpo", "typhoon", "disaster", "scaffold"):
    app = ids()[key]
    f = get("preview/app/form/fields.json", app=app)["properties"]["koji_no"]
    if f.get("lookup"):
        f.pop("lookup")
        send("DELETE", "preview/app/form/fields.json", {"app": app, "fields": ["koji_no"]}) if False else None
        send("PUT", "preview/app/form/fields.json", {"app": app, "properties": {"koji_no": {**f, "lookup": None}}})
        deploy(app)
    upd = []
    for r in get("records.json", app=app, query='legacy_id != "" limit 500', fields=["$id", "legacy_id", "koji_name"])["records"]:
        name = src.get(r["legacy_id"]["value"])
        if name and name != r["koji_name"]["value"]:
            upd.append({"id": r["$id"]["value"], "record": {"koji_name": {"value": name}}})
    if upd:
        send("PUT", "records.json", {"app": app, "records": upd})
    print(key, "lookup removed / names restored", len(upd))
