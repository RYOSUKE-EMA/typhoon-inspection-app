# 旧アプリ（app 5287 の安全旬報＋Vercel版の承認記録）→ 安全旬報 kintone版（5829）へ移行
# 何度実行してもよい（移行元IDが既にあるものはスキップ）。確認済のものだけを「確認済」で登録する。
#   python migrate_records.py            … 実行
#   python migrate_records.py --dry-run  … 登録せず内容だけ表示
import html
import re
import sys

import requests

from kapi import ids, get, send, deploy, AUTH

DRY = "--dry-run" in sys.argv
APP = ids()["junpo"]
SRC_APP = 5287
VERCEL = "https://typhoon-inspection-app.vercel.app"
ME = "c0114101"


def norm(s):
    return re.sub(r"[\s　]", "", s or "")


# cybozu ユーザー（表示名→ログイン名）
users = {}
offset = 0
while True:
    r = requests.get("https://symgrp.cybozu.com/v1/users.json", headers={"X-Cybozu-Authorization": AUTH},
                     params={"offset": offset, "size": 100}, timeout=60).json()["users"]
    if not r:
        break
    for u in r:
        users[norm(u["name"])] = u["code"]
    offset += 100

tl_codes = {e["code"] for e in get("app/form/fields.json", app=APP)["properties"]["approver_tl"]["entities"]}
done = {r["legacy_id"]["value"] for r in get("records.json", app=APP, query='legacy_id != "" limit 500', fields=["legacy_id"])["records"]}
src = get("records.json", app=SRC_APP, query='category = "安全旬報" order by $id asc limit 500')["records"]


def scrape(report_id):
    h = requests.get(f"{VERCEL}/reports/safety_patrol/{report_id}",
                     params={"kintone_user": "江間", "kintone_code": ME}, timeout=60).text
    t = lambda s: html.unescape(re.sub(r"<[^>]+>", "", s)).strip()
    dest = re.search(r"提出先（通知先）</th><td>(.*?)</td>", h, re.S)
    approvals = re.findall(r"承認者</th><td>(.*?)</td></tr>\s*<tr><th>承認日時</th><td>(.*?)</td></tr>\s*<tr><th>コメント</th><td>(.*?)</td>", h, re.S)
    returns = re.findall(r"<tr>\s*<td>([^<]*)</td>\s*<td>([^<]*)</td>\s*<td style=\"white-space:pre-wrap;\">(.*?)</td>\s*<td>([^<]*)</td>\s*</tr>", h, re.S)
    return {"dest": t(dest.group(1)) if dest else "",
            "approvals": [tuple(t(x) for x in a) for a in approvals],
            "returns": [tuple(t(x) for x in r) for r in returns]}


# 旧アプリで工事№を誤入力していたもの（報告書ID → 正しい工事№）
NO_FIX = {"43": "81041093"}   # 84011093 は 81041093（とぴあ浜松農協 複合選果場）の入れ違い

plan, skipped = [], []
for s in src:
    rid = s["report_id"]["value"]
    if rid in done:
        continue
    if s["status"]["value"] != "確認済":
        skipped.append((rid, s["project_name"]["value"], "未承認（切替時に対応）"))
        continue
    koji_no = NO_FIX.get(rid, s["project_no"]["value"] or "")
    if not re.fullmatch(r"\d{8}", koji_no):
        skipped.append((rid, s["project_name"]["value"], f"工事№が不正（{s['project_no']['value']}）"))
        continue
    info = scrape(rid)
    tl_name = (re.search(r"TL：([^／]+)", info["dest"]) or [None, ""])[1].strip()
    tl = users.get(norm(tl_name), "")
    if tl not in tl_codes and info["approvals"]:
        tl = users.get(norm(info["approvals"][0][0]), tl)
    if tl not in tl_codes:
        skipped.append((rid, s["project_name"]["value"], f"承認TLを特定できない（{tl_name}）"))
        continue
    inspector = users.get(norm(s["inspector"]["value"]), "")
    lines = [f"旧アプリ報告書ID：{rid}", f"提出先：{info['dest'] or '（記録なし）'}"]
    for a in info["approvals"]:
        lines.append(f"承認：{a[0]}　{a[1]}" + (f"　コメント：{a[2]}" if a[2] else ""))
    for r in info["returns"]:
        lines.append(f"差し戻し：{r[1]}　{r[0]}" + (f"　理由：{r[2]}" if r[2] else "") + f"　再提出：{r[3]}")
    if koji_no != s["project_no"]["value"]:
        lines.append(f"工事№：旧アプリでは {s['project_no']['value']} と入力されていたため {koji_no} に訂正して移行")
    if not inspector:
        lines.append(f"点検者（旧）：{s['inspector']['value']}")
    rec = {
        "koji_no": {"value": koji_no},
        "site_manager": {"value": s["site_manager"]["value"]},
        "inspector": {"value": [{"code": inspector or ME}]},
        "inspect_date": {"value": s["inspect_date"]["value"]},
        "report_month": {"value": s["report_month"]["value"]},
        "report_period": {"value": s["report_period"]["value"]},
        "report_round": {"value": s["report_round"]["value"]},
        "approver_tl": {"value": [{"code": tl}]},
        "meeting_date": {"value": s["meeting_date"]["value"] or None},
        "meeting_attendees": {"value": s["meeting_attendees"]["value"]},
        "meeting_notes": {"value": s["meeting_notes"]["value"]},
        "legacy_id": {"value": rid},
        "legacy_note": {"value": "\n".join(lines)},
        "作成者": {"value": {"code": inspector or ME}},
        "作成日時": {"value": s["作成日時"]["value"]},
        "checklist": {"value": [{"value": {
            "item_no": {"value": row["value"]["item_no"]["value"]},
            "item_name": {"value": row["value"]["item_name"]["value"]},
            "result": {"value": row["value"]["item_result"]["value"] or "－"},
            "note": {"value": row["value"]["item_note"]["value"]},
        }} for row in s["checklist"]["value"]]},
    }
    plan.append((rid, rec))

print(f"移行対象 {len(plan)} 件／スキップ {len(skipped)} 件／移行済 {len(done)} 件")
for x in skipped:
    print("  skip:", x)
if DRY or not plan:
    for rid, rec in plan:
        print("  plan:", rid, rec["koji_no"]["value"], rec["report_month"]["value"], rec["report_period"]["value"],
              rec["作成者"]["value"]["code"], rec["approver_tl"]["value"][0]["code"])
    sys.exit(0)

# 移行中だけ「未提出」の作業者を空にする（作成者以外は移行アクションを実行できないため）
status = get("preview/app/status.json", app=APP)
orig = status["states"]["未提出"]["assignee"]
tmp = {"type": "ONE", "entities": []}   # 先頭ステータスは「空」か「作成者」しか指定できない。空なら編集権限者が実行可
tmp_states = {k: dict(v) for k, v in status["states"].items()}
tmp_states["未提出"]["assignee"] = tmp
send("PUT", "preview/app/status.json", {"app": APP, "states": tmp_states})
deploy(APP)
try:
    for rid, rec in plan:
        new_id = send("POST", "record.json", {"app": APP, "record": rec})["id"]
        send("PUT", "record/status.json", {"app": APP, "id": new_id, "action": "移行データ登録"})
        print("  migrated", rid, "->", new_id)
finally:
    send("PUT", "preview/app/status.json", {"app": APP, "states": status["states"]})
    deploy(APP)
print("done")
