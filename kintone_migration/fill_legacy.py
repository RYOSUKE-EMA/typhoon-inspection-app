# 切替時の既存データ補完（Vercel版 → 本体アプリ）
#   python fill_legacy.py 5287                 … 本番（承認待ちは承認待ちへ。担当者にkintone通知が届く）
#   python fill_legacy.py 5835 --no-pending    … 準備用（承認待ちは「未提出」のまま。通知を出さない）
#   python fill_legacy.py 5835 --copy-from 5287 --no-pending … 準備用に5287の記録をコピーしてから補完
# 何度実行してもよい（ステータスが「未提出」の旧レコードだけを処理する）。
#  1. Vercel版にあって本体アプリに無い報告書（足場など同期対象外のもの）を画面から取り込む
#  2. 旧レコードに、提出先（承認者）・承認記録・差し戻し履歴・足場の項目を補う
#  3. Vercel版の状態に合わせてプロセス管理のステータスを進める
import html
import re
import sys
from datetime import datetime, timedelta

import requests

from kapi import get, send, deploy, AUTH

APP = int(sys.argv[1])
NO_PENDING = "--no-pending" in sys.argv
COPY_FROM = int(sys.argv[sys.argv.index("--copy-from") + 1]) if "--copy-from" in sys.argv else None
V = "https://typhoon-inspection-app.vercel.app"
Q = {"kintone_user": "江間", "kintone_code": "c0114101"}
CATS = {"safety_patrol": "安全旬報", "scaffold": "足場点検記録", "typhoon": "台風養生点検", "disaster": "災害時現場点検"}
norm = lambda s: re.sub(r"[\s　]", "", s or "")
txt = lambda s: html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def utc(s):
    s = s.strip().replace("T", " ")[:19]
    if not re.match(r"\d{4}-\d\d-\d\d \d\d:\d\d", s):
        return None
    d = datetime.strptime(s[:16], "%Y-%m-%d %H:%M") - timedelta(hours=9)
    return d.strftime("%Y-%m-%dT%H:%M:00Z")


def fetch_all(app, query="", fields=None):
    out, last = [], 0
    while True:
        p = {"app": app, "query": (f"({query}) and " if query else "") + f"$id > {last} order by $id asc limit 500"}
        if fields:
            for i, f in enumerate(fields + ["$id"]):
                p[f"fields[{i}]"] = f
        r = get("records.json", **p)["records"]
        out += r
        if len(r) < 500:
            return out
        last = r[-1]["$id"]["value"]


users, off = {}, 0
while True:
    r = requests.get("https://symgrp.cybozu.com/v1/users.json", headers={"X-Cybozu-Authorization": AUTH},
                     params={"offset": off, "size": 100}, timeout=60).json()["users"]
    if not r:
        break
    users.update({norm(u["name"]): u["code"] for u in r})
    off += 100

# 0. 準備用：5287 の記録をコピー
if COPY_FROM:
    have = {r["report_id"]["value"] for r in fetch_all(APP, 'report_id > 0', ["report_id"])}
    recs = []
    for r in fetch_all(COPY_FROM):
        if r["report_id"]["value"] in have:
            continue
        rec = {k: {"value": v["value"]} for k, v in r.items() if k in (
            "report_id", "category", "project_no", "project_name", "inspector", "site_manager", "inspect_date", "report_month",
            "report_period", "report_round", "meeting_date", "meeting_attendees", "meeting_notes", "status")}
        rec["作成日時"] = {"value": r["作成日時"]["value"]}
        rec["checklist"] = {"value": [{"value": {k: {"value": c["value"][k]["value"]} for k in ("item_no", "item_name", "item_result", "item_note")}}
                                      for c in r["checklist"]["value"]]}
        recs.append(rec)
    for i in range(0, len(recs), 100):
        send("POST", "records.json", {"app": APP, "records": recs[i:i + 100]})
    print("copied", len(recs))


def scrape(cat, rid):
    h = requests.get(f"{V}/reports/{cat}/{rid}", params=Q, timeout=60).text
    info = {txt(k): v for k, v in re.findall(r"<tr><th[^>]*>(.*?)</th><td>(.*?)</td></tr>", h.split("点検項目")[0], re.S)}
    status = ""
    m = re.search(r"状態</th><td>(.*?)</td>", h, re.S)
    if m:
        status = txt(m.group(1)).replace("差し戻し中", "差し戻し")
    items = []
    tb = re.search(r'<table class="item-table">.*?<tbody>(.*?)</tbody>', h, re.S)
    if tb:
        for tr in re.findall(r"<tr>(.*?)</tr>", tb.group(1), re.S):
            tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
            if len(tds) >= 4:
                items.append((re.sub(r"<button.*?</button>", "", tds[1], flags=re.S), tds[2], tds[3]))
    approvals = []
    sec = h.split("承認欄")[1] if "承認欄" in h else ""
    for si, block in enumerate(re.split(r'<div style="font-weight:700; margin-bottom:8px;">', sec)[1:]):
        roles = re.match(r"\d+\.\s*([^<]*?)承認", block).group(1).split("・")
        parts = re.split(r'<div style="font-weight:500; margin-bottom:6px;">([^<]+)</div>', block)
        pairs = [(roles[0], parts[0])] if len(parts) == 1 else list(zip(parts[1::2], parts[2::2]))
        for role, chunk in pairs:
            a = re.search(r"承認者</th><td>(.*?)</td></tr>\s*<tr><th>承認日時</th><td>(.*?)</td></tr>\s*<tr><th>コメント</th><td>(.*?)</td>", chunk, re.S)
            if a:
                approvals.append({"step": si, "role": role.strip(), "name": txt(a.group(1)), "at": utc(txt(a.group(2))), "comment": txt(a.group(3))})
    returns = []
    for r in re.findall(r"<tr>\s*<td>([^<]*)</td>\s*<td>([^<]*)</td>\s*<td style=\"white-space:pre-wrap;\">(.*?)</td>\s*<td>([^<]*)</td>\s*</tr>", h, re.S):
        role, _, by = txt(r[1]).partition("：")
        returns.append({"at": utc(r[0]), "role": role, "by": by, "reason": txt(r[2]), "resub": utc(r[3])})
    return {"info": info, "status": status, "items": items, "approvals": approvals, "returns": returns}


def code_of(name):
    return users.get(norm(name), "")


# 1. Vercel版にあって本体アプリに無い報告書を取り込む
have = {r["report_id"]["value"] for r in fetch_all(APP, 'report_id > 0', ["report_id"])}
new = []
for key, label in CATS.items():
    ids = sorted(set(re.findall(rf"/reports/{key}/(\d+)", requests.get(f"{V}/reports/{key}", params=Q, timeout=60).text)), key=int)
    for rid in ids:
        if rid in have:
            continue
        s = scrape(key, rid)
        i = s["info"]
        rec = {"report_id": {"value": rid}, "category": {"value": label}, "project_no": {"value": txt(i.get("工事ナンバー"))},
               "project_name": {"value": txt(i.get("工事名"))}, "inspector": {"value": txt(i.get("点検者"))},
               "inspect_date": {"value": txt(i.get("点検日"))[:10] or None}, "subtype": {"value": txt(i.get("足場の種類"))},
               "checklist": {"value": [{"value": {"item_no": {"value": n + 1}, "item_name": {"value": txt(a)}, "item_result": {"value": txt(b)},
                                                  "item_note": {"value": txt(c)}}} for n, (a, b, c) in enumerate(s["items"])]}}
        new.append(rec)
        print("import", key, rid, txt(i.get("工事名")))
if new:
    send("POST", "records.json", {"app": APP, "records": new})

# 2・3. 旧レコードの補完とステータス
targets = fetch_all(APP, 'report_id > 0 and ステータス in ("未提出")')
key_of = {v: k for k, v in CATS.items()}
plan = []
for r in targets:
    cat = key_of.get(r["category"]["value"])
    if not cat:
        continue
    s = scrape(cat, r["report_id"]["value"])
    i = s["info"]
    upd = {}
    dest = txt(i.get("提出先（通知先）"))
    for role, field in (("TL", "approver_tl"), ("GL", "approver_gl"), ("BL", "approver_bl"), ("安全検査室", "safety_officer")):
        m = re.search(role + r"：([^／]+)", dest)
        c = code_of(m.group(1)) if m else ""
        if c:
            upd[field] = {"value": [{"code": c}]}
    if cat == "scaffold":
        reason = txt(i.get("点検実施理由"))
        other = re.match(r"その他（(.*)）$", reason)
        upd["subtype"] = {"value": txt(i.get("足場の種類"))}
        upd["inspect_reason"] = {"value": "その他" if other else reason}
        upd["inspect_reason_other"] = {"value": other.group(1) if other else ""}
        upd["assembler_name"] = {"value": txt(i.get("組立者"))}
        for label, n_field, no_field in (("点検者の資格", "inspector_qual", "inspector_qual_no"), ("組立者の資格", "assembler_qual", "assembler_qual_no")):
            q = re.match(r"(.*?)(?:（資格番号：(.*)）)?$", txt(i.get(label)))
            upd[n_field] = {"value": q.group(1)}
            upd[no_field] = {"value": q.group(2) or ""}
    upd["approvals"] = {"value": [{"value": {"ap_step": {"value": a["step"]}, "ap_role": {"value": a["role"]}, "ap_name": {"value": a["name"]},
                                              "ap_code": {"value": code_of(a["name"])}, "ap_comment": {"value": a["comment"]}, "ap_at": {"value": a["at"]}}}
                                   for a in s["approvals"]]}
    upd["returns"] = {"value": [{"value": {"rt_role": {"value": x["role"]}, "rt_by": {"value": x["by"]}, "rt_reason": {"value": x["reason"]},
                                            "rt_at": {"value": x["at"]}, "rt_resub_at": {"value": x["resub"]}}} for x in s["returns"]]}
    st = s["status"]
    if cat == "scaffold":
        action, assignee = "記録する", None
    elif st == "確認済":
        action, assignee = "移行データ登録", None
    elif st in ("TL承認待ち", "未確認"):
        action, assignee = "移行（TL承認待ち）", (upd.get("approver_tl") or {"value": [{"code": ""}]})["value"][0]["code"]
    elif "承認待ち" in st:
        action, assignee = "移行（GL・BL承認待ち）", None
    else:
        action, assignee = None, None   # 差し戻し中など：未提出のまま（提出者が再提出する）
    if NO_PENDING and action and action.startswith("移行（"):
        action = None
    plan.append((r["$id"]["value"], upd, action, assignee, st))

for rid, upd, action, assignee, st in plan:
    send("PUT", "record.json", {"app": APP, "id": rid, "record": upd})
print("filled", len(plan))

# ステータス：初期ステータスの作業者は「作成者」（旧レコードは Administrator）なので、実行中だけ作業者を空にする
acts = [(rid, a, asg) for rid, _, a, asg, _ in plan if a]
if acts:
    status = get("preview/app/status.json", app=APP)
    tmp = {k: dict(v) for k, v in status["states"].items()}
    tmp["未提出"]["assignee"] = {"type": "ONE", "entities": []}
    send("PUT", "preview/app/status.json", {"app": APP, "states": tmp})
    deploy(APP)
    try:
        for rid, action, assignee in acts:
            body = {"app": APP, "id": rid, "action": action}
            if assignee:
                body["assignee"] = assignee
            send("PUT", "record/status.json", body)
    finally:
        send("PUT", "preview/app/status.json", {"app": APP, "states": status["states"]})
        deploy(APP)
from collections import Counter
print("status:", Counter((p[2] or f"未提出のまま（{p[4]}）") for p in plan))
