# 台風養生点検の旧データ（app 5287）→ kintone版（5832）へ移行。確認済のみ・再実行可。
import html
import re

import requests

from kapi import ids, get, send, deploy, AUTH

APP = ids()["typhoon"]
VERCEL = "https://typhoon-inspection-app.vercel.app"
ME = "c0114101"
norm = lambda s: re.sub(r"[\s　]", "", s or "")

users, off = {}, 0
while True:
    r = requests.get("https://symgrp.cybozu.com/v1/users.json", headers={"X-Cybozu-Authorization": AUTH},
                     params={"offset": off, "size": 100}, timeout=60).json()["users"]
    if not r:
        break
    users.update({norm(u["name"]): u["code"] for u in r})
    off += 100

done = {r["legacy_id"]["value"] for r in get("records.json", app=APP, query='legacy_id != "" limit 500', fields=["legacy_id"])["records"]}
src = [s for s in get("records.json", app=5287, query='category = "台風養生点検" limit 500')["records"]
       if s["report_id"]["value"] not in done and s["status"]["value"] == "確認済"]
plan = []
for s in src:
    rid = s["report_id"]["value"]
    h = requests.get(f"{VERCEL}/reports/typhoon/{rid}", params={"kintone_user": "江間", "kintone_code": ME}, timeout=60).text
    t = lambda x: html.unescape(re.sub(r"<[^>]+>", "", x)).strip()
    dest = re.search(r"提出先（通知先）</th><td>(.*?)</td>", h, re.S)
    dest = t(dest.group(1)) if dest else ""
    apps = [tuple(t(x) for x in a) for a in re.findall(
        r"承認者</th><td>(.*?)</td></tr>\s*<tr><th>承認日時</th><td>(.*?)</td></tr>\s*<tr><th>コメント</th><td>(.*?)</td>", h, re.S)]
    tl_name = (re.search(r"TL：([^／]+)", dest) or [None, apps[0][0] if apps else ""])[1].strip()
    tl = users.get(norm(tl_name)) or users.get(norm(apps[0][0]) if apps else "", "")
    insp = users.get(norm(s["inspector"]["value"]), "")
    lines = [f"旧アプリ報告書ID：{rid}", f"提出先：{dest or '（記録なし）'}"] + \
            [f"承認：{a[0]}　{a[1]}" + (f"　コメント：{a[2]}" if a[2] else "") for a in apps]
    if not insp:
        lines.append(f"点検者（旧）：{s['inspector']['value']}")
    plan.append({
        "koji_no": {"value": s["project_no"]["value"]},
        "inspector": {"value": [{"code": insp or ME}]},
        "inspect_date": {"value": s["inspect_date"]["value"]},
        "approver_tl": {"value": [{"code": tl}]},
        "legacy_id": {"value": rid}, "legacy_note": {"value": "\n".join(lines)},
        "作成者": {"value": {"code": insp or ME}}, "作成日時": {"value": s["作成日時"]["value"]},
        "checklist": {"value": [{"value": {
            "item_no": {"value": r["value"]["item_no"]["value"]}, "item_name": {"value": r["value"]["item_name"]["value"]},
            "result": {"value": r["value"]["item_result"]["value"] or "－"}, "note": {"value": r["value"]["item_note"]["value"]}}}
            for r in s["checklist"]["value"]]},
    })
print("移行対象", len(plan))
if plan:
    status = get("preview/app/status.json", app=APP)
    tmp = {k: dict(v) for k, v in status["states"].items()}
    tmp["未提出"]["assignee"] = {"type": "ONE", "entities": []}
    send("PUT", "preview/app/status.json", {"app": APP, "states": tmp})
    deploy(APP)
    try:
        for rec in plan:
            nid = send("POST", "record.json", {"app": APP, "record": rec})["id"]
            send("PUT", "record/status.json", {"app": APP, "id": nid, "action": "移行データ登録"})
            print("migrated", rec["legacy_id"]["value"], "->", nid)
    finally:
        send("PUT", "preview/app/status.json", {"app": APP, "states": status["states"]})
        deploy(APP)
