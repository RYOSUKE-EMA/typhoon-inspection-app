# Vercel版の承認者名簿（ブロック・担当工事№つき）を共通設定5831の「名簿」へ。既存の移行レコードに点検者（氏名）を補完。
import html
import re

import requests

from kapi import ids, get, send

conf = ids()["tenken_conf"]
h = requests.get("https://typhoon-inspection-app.vercel.app/approvers", timeout=60).text
have = {(r["role"]["value"], (r["member"]["value"] or [{}])[0].get("code")) for r in
        get("records.json", app=conf, query='kind in ("名簿") limit 500')["records"]}
recs = []
for sec in re.split(r'<h2[^>]*><span class="accent-bar"></span>', h)[1:]:
    role = sec.split("<")[0].strip()
    if role not in ("TL", "GL", "BL", "安全検査室"):
        continue
    for tr in re.findall(r"<tr>(.*?)</tr>", sec, re.S):
        tds = re.findall(r"<td>(.*?)</td>", tr, re.S)
        m = re.search(r'<option value="([^"]*)" selected>', tr)
        if len(tds) < 3:
            continue
        code = html.unescape(re.sub(r"<[^>]+>", "", tds[-3])).strip() if False else None
        cells = [html.unescape(re.sub(r"<[^>]+>", "", t)).strip() for t in tds]
        # 列：ブロック｜表示名｜ログイン名｜担当工事№｜削除
        name, code, koji = cells[1], cells[2], cells[3]
        if (role, code) in have:
            continue
        recs.append({"kind": {"value": "名簿"}, "role": {"value": role}, "member": {"value": [{"code": code}]},
                     "block": {"value": m.group(1) if m else ""}, "koji_nos": {"value": koji}})
        print(role, name, code, m.group(1) if m else "(共通)", koji)
if recs:
    send("POST", "records.json", {"app": conf, "records": recs})
print("roster added", len(recs))

# 点検者（氏名）の補完：移行元（app5287）の点検者名をそのまま入れる
src = {r["report_id"]["value"]: r["inspector"]["value"] for r in
       get("records.json", app=5287, query="limit 500", fields=["report_id", "inspector"])["records"]}
for key in ("junpo", "typhoon"):
    app = ids()[key]
    upd = []
    for r in get("records.json", app=app, query='inspector_name = "" limit 500',
                 fields=["$id", "legacy_id", "inspector"])["records"]:
        name = src.get(r["legacy_id"]["value"]) or ", ".join(u["name"] for u in r["inspector"]["value"])
        upd.append({"id": r["$id"]["value"], "record": {"inspector_name": {"value": name}}})
    if upd:
        send("PUT", "records.json", {"app": app, "records": upd})
    print(key, "inspector_name filled", len(upd))
