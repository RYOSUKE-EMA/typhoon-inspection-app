# Vercel版の提出状況にある「対象期間（手動設定）」と「対象外」を、設定アプリ5830へ取り込む（再実行可・重複しない）
import html
import re
from datetime import date

import requests

from kapi import ids, get, send

CONF = ids()["junpo_conf"]
V = "https://typhoon-inspection-app.vercel.app/safety_patrol/status"
Q = {"kintone_user": "江間", "kintone_code": "c0114101"}
have = get("records.json", app=CONF, query='kind in ("対象期間", "対象外") limit 500')["records"]
have_p = {r["koji_no"]["value"]: r for r in have if r["kind"]["value"] == "対象期間"}
have_x = {(r["koji_no"]["value"], int(r["year"]["value"]), int(r["month"]["value"]), r["period"]["value"]) for r in have if r["kind"]["value"] == "対象外"}

today = date.today()
months = []
y, m = 2026, 9
while (y, m) <= (today.year, today.month + 1 if today.month < 12 else 12):
    months.append((y, m))
    y, m = (y + 1, 1) if m == 12 else (y, m + 1)

periods, excl = {}, set()
for y, m in months:
    h = requests.get(V, params=dict(Q, year=y, month=m), timeout=60).text
    body = h.split("<tbody>")[1].split("</tbody>")[0] if "<tbody>" in h else ""
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.S):
        no = re.search(r"<td>\s*(\d{8})", tr)
        if not no:
            continue
        no = no.group(1)
        cp = re.search(r'<span class="custom"[^>]*>([\d/]*|未定) 〜 ([\d/]*|未定)</span>', tr)
        if cp:
            periods[no] = tuple(None if x == "未定" else x.replace("/", "-") for x in cp.groups())
        cells = re.findall(r'<td class="status-cell">(.*?)</td>', tr, re.S)
        for per, c in zip(["上旬", "中旬", "下旬"], cells):
            if ">対象外<" in c:
                excl.add((no, y, m, per))

recs = []
for no, (s, e) in periods.items():
    if no not in have_p:
        recs.append({"kind": {"value": "対象期間"}, "koji_no": {"value": no}, "start_date": {"value": s}, "end_date": {"value": e},
                     "memo": {"value": "Vercel版から移行"}})
for no, y, m, per in sorted(excl - have_x):
    recs.append({"kind": {"value": "対象外"}, "koji_no": {"value": no}, "year": {"value": y}, "month": {"value": m},
                 "period": {"value": per}, "memo": {"value": "Vercel版から移行"}})
if recs:
    send("POST", "records.json", {"app": CONF, "records": recs})
print("periods", periods, "| exclusions", len(excl), "| added", len(recs))
