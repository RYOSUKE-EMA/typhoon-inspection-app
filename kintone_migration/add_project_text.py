# 工事№・工事名を自由入力の文字フィールド（project_no / project_name）で持つ（元のアプリと同じ）。
# ルックアップの koji_no は API で解除できないため、必須を外して使わない。既存レコードは値を写す。
from kapi import ids, get, send, deploy

src = {r["report_id"]["value"]: r["project_name"]["value"] for r in
       get("records.json", app=5287, query="limit 500", fields=["report_id", "project_name"])["records"]}
for key in ("junpo", "typhoon", "disaster", "scaffold"):
    app = ids()[key]
    cur = get("preview/app/form/fields.json", app=app)["properties"]
    add = {k: v for k, v in {
        "project_no": {"type": "SINGLE_LINE_TEXT", "code": "project_no", "label": "工事ナンバー"},
        "project_name": {"type": "SINGLE_LINE_TEXT", "code": "project_name", "label": "工事名（入力値）"},
    }.items() if k not in cur}
    if add:
        send("POST", "preview/app/form/fields.json", {"app": app, "properties": add})
    upd = {}
    for c in ("koji_no", "koji_name"):
        if cur[c].get("required"):
            upd[c] = {**cur[c], "required": False}
    if upd:
        send("PUT", "preview/app/form/fields.json", {"app": app, "properties": upd})
    deploy(app)
    recs = get("records.json", app=app, query='project_no = "" limit 500', fields=["$id", "koji_no", "koji_name", "legacy_id"])["records"]
    rows = [{"id": r["$id"]["value"], "record": {
        "project_no": {"value": r["koji_no"]["value"]},
        "project_name": {"value": src.get(r["legacy_id"]["value"]) or r["koji_name"]["value"]}}} for r in recs]
    if rows:
        send("PUT", "records.json", {"app": app, "records": rows})
    print(key, "filled", len(rows))
