# 設定アプリ（5830）の初期データ：PDF資材・点検項目・追加対象
import json
from kapi import ids, get, send, upload, HERE

conf = ids()["junpo_conf"]
existing = get("records.json", app=conf, query='kind in ("PDF資材", "点検項目", "追加対象") limit 500')["records"]
have = {(r["kind"]["value"], r["koji_no"]["value"]) for r in existing}
recs = []
if ("PDF資材", "") not in have:
    fk1 = upload(HERE / "assets" / "NotoSansJP-junpo.ttf", mime="font/ttf")
    fk2 = upload(HERE / "assets" / "safety_patrol.pdf", mime="application/pdf")
    recs.append({"kind": {"value": "PDF資材"}, "memo": {"value": "旬報PDF用フォント・様式（削除しないこと）"},
                 "files": {"value": [{"fileKey": fk1}, {"fileKey": fk2}]}})
if ("点検項目", "") not in have:
    items = json.loads((HERE / "assets" / "junpo_items.json").read_text(encoding="utf-8"))
    recs.append({"kind": {"value": "点検項目"}, "memo": {"value": "安全旬報の点検項目（1行1項目・順番どおり）"},
                 "body": {"value": "\n".join(items)}})
if ("追加対象", "81042262") not in have:
    recs.append({"kind": {"value": "追加対象"}, "koji_no": {"value": "81042262"}, "memo": {"value": "小工事（2026-11 江間さん指示）"}})
if recs:
    print(send("POST", "records.json", {"app": conf, "records": recs}))
print("ok")
