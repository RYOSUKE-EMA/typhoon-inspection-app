# 点検記録の本体アプリ（本番 5287「建築G 各種点検記録」／準備用 5835）を、再現画面（tenken_app.js）用に設定する
#   python setup_main.py 5835   … 準備用
#   python setup_main.py 5287   … 本番（切替時）
# 4種類の点検を1アプリで扱い、プロセス管理は「点検種別（category）」で分岐する。何度実行してもよい。
import sys

from kapi import get, send, deploy

APP = int(sys.argv[1])
SAFETY_OFFICER = "c0100109"


def opts(values):
    return {v: {"label": v, "index": str(i)} for i, v in enumerate(values)}


def ent(code):
    return {"entity": {"type": "FIELD_ENTITY", "code": code}, "includeSubs": False}


def cond(*cats):
    return " or ".join(f'category = "{c}"' for c in cats)


# 5287 にもともとある項目（準備用アプリにも同じものを作る）
BASE = {
    "report_id": {"type": "NUMBER", "code": "report_id", "label": "元報告書ID", "digit": False},
    "category": {"type": "SINGLE_LINE_TEXT", "code": "category", "label": "点検種別"},
    "project_no": {"type": "SINGLE_LINE_TEXT", "code": "project_no", "label": "工事ナンバー"},
    "project_name": {"type": "SINGLE_LINE_TEXT", "code": "project_name", "label": "工事名"},
    "inspector": {"type": "SINGLE_LINE_TEXT", "code": "inspector", "label": "点検者"},
    "site_manager": {"type": "SINGLE_LINE_TEXT", "code": "site_manager", "label": "作業所長"},
    "inspect_date": {"type": "DATE", "code": "inspect_date", "label": "点検日"},
    "report_month": {"type": "NUMBER", "code": "report_month", "label": "対象月", "digit": False},
    "report_period": {"type": "SINGLE_LINE_TEXT", "code": "report_period", "label": "旬"},
    "report_round": {"type": "NUMBER", "code": "report_round", "label": "第○回", "digit": False},
    "meeting_date": {"type": "DATE", "code": "meeting_date", "label": "協議会実施日"},
    "meeting_attendees": {"type": "SINGLE_LINE_TEXT", "code": "meeting_attendees", "label": "参加者名"},
    "meeting_notes": {"type": "MULTI_LINE_TEXT", "code": "meeting_notes", "label": "協議事項・管理重点事項"},
    "status": {"type": "SINGLE_LINE_TEXT", "code": "status", "label": "状態"},
    "pdf_file": {"type": "FILE", "code": "pdf_file", "label": "PDFファイル"},
    "checklist": {"type": "SUBTABLE", "code": "checklist", "label": "点検項目", "fields": {
        "item_no": {"type": "NUMBER", "code": "item_no", "label": "No", "digit": False},
        "item_name": {"type": "SINGLE_LINE_TEXT", "code": "item_name", "label": "点検項目"},
        "item_result": {"type": "SINGLE_LINE_TEXT", "code": "item_result", "label": "結果"},
        "item_note": {"type": "SINGLE_LINE_TEXT", "code": "item_note", "label": "備考"},
    }},
}
# 再現画面のために追加する項目
EXTRA = {
    "subtype": {"type": "SINGLE_LINE_TEXT", "code": "subtype", "label": "足場の種類"},
    "inspect_reason": {"type": "SINGLE_LINE_TEXT", "code": "inspect_reason", "label": "点検実施理由"},
    "inspect_reason_other": {"type": "SINGLE_LINE_TEXT", "code": "inspect_reason_other", "label": "点検実施理由（その他の内容）"},
    "assembler_name": {"type": "SINGLE_LINE_TEXT", "code": "assembler_name", "label": "組立者氏名"},
    "assembler_qual": {"type": "SINGLE_LINE_TEXT", "code": "assembler_qual", "label": "組立者の資格名"},
    "assembler_qual_no": {"type": "SINGLE_LINE_TEXT", "code": "assembler_qual_no", "label": "組立者の資格番号"},
    "inspector_qual": {"type": "SINGLE_LINE_TEXT", "code": "inspector_qual", "label": "点検者の資格名"},
    "inspector_qual_no": {"type": "SINGLE_LINE_TEXT", "code": "inspector_qual_no", "label": "点検者の資格番号"},
    "approver_tl": {"type": "USER_SELECT", "code": "approver_tl", "label": "承認するTL"},
    "approver_gl": {"type": "USER_SELECT", "code": "approver_gl", "label": "承認するGL"},
    "approver_bl": {"type": "USER_SELECT", "code": "approver_bl", "label": "承認するBL"},
    "safety_officer": {"type": "USER_SELECT", "code": "safety_officer", "label": "安全検査室（提出時に通知）"},
    "return_reason": {"type": "MULTI_LINE_TEXT", "code": "return_reason", "label": "差し戻し理由"},
    "approvals": {"type": "SUBTABLE", "code": "approvals", "label": "承認記録", "fields": {
        "ap_step": {"type": "NUMBER", "code": "ap_step", "label": "段", "digit": False},
        "ap_role": {"type": "SINGLE_LINE_TEXT", "code": "ap_role", "label": "役割"},
        "ap_name": {"type": "SINGLE_LINE_TEXT", "code": "ap_name", "label": "承認者"},
        "ap_code": {"type": "SINGLE_LINE_TEXT", "code": "ap_code", "label": "承認者ログイン名"},
        "ap_comment": {"type": "SINGLE_LINE_TEXT", "code": "ap_comment", "label": "コメント"},
        "ap_at": {"type": "DATETIME", "code": "ap_at", "label": "承認日時"},
    }},
    "returns": {"type": "SUBTABLE", "code": "returns", "label": "差し戻し履歴", "fields": {
        "rt_role": {"type": "SINGLE_LINE_TEXT", "code": "rt_role", "label": "役割"},
        "rt_by": {"type": "SINGLE_LINE_TEXT", "code": "rt_by", "label": "差し戻した人"},
        "rt_reason": {"type": "MULTI_LINE_TEXT", "code": "rt_reason", "label": "理由"},
        "rt_at": {"type": "DATETIME", "code": "rt_at", "label": "差し戻し日時"},
        "rt_resub_at": {"type": "DATETIME", "code": "rt_resub_at", "label": "再提出日時"},
    }},
}

cur = get("preview/app/form/fields.json", app=APP)["properties"]
add = {k: v for k, v in {**BASE, **EXTRA}.items() if k not in cur}
if add:
    send("POST", "preview/app/form/fields.json", {"app": APP, "properties": add})
    print("added fields:", list(add))

APPROVAL = cond("安全旬報", "台風養生点検", "災害時現場点検")
send("PUT", "preview/app/status.json", {"app": APP, "enable": True, "states": {
    "未提出": {"name": "未提出", "index": "0", "assignee": {"type": "ONE", "entities": [ent("作成者")]}},
    "TL承認待ち": {"name": "TL承認待ち", "index": "1", "assignee": {"type": "ONE", "entities": [ent("approver_tl")]}},
    "GL・BL承認待ち": {"name": "GL・BL承認待ち", "index": "2", "assignee": {"type": "ALL", "entities": [ent("approver_gl"), ent("approver_bl")]}},
    "差し戻し": {"name": "差し戻し", "index": "3", "assignee": {"type": "ONE", "entities": [ent("作成者")]}},
    "確認済": {"name": "確認済", "index": "4", "assignee": {"type": "ONE", "entities": []}},
    "記録済": {"name": "記録済", "index": "5", "assignee": {"type": "ONE", "entities": []}},
}, "actions": [
    {"name": "提出する", "from": "未提出", "to": "TL承認待ち", "filterCond": APPROVAL},
    {"name": "記録する", "from": "未提出", "to": "記録済", "filterCond": cond("足場点検記録")},
    {"name": "承認する", "from": "TL承認待ち", "to": "確認済", "filterCond": cond("安全旬報", "台風養生点検")},
    {"name": "承認する（TL）", "from": "TL承認待ち", "to": "GL・BL承認待ち", "filterCond": cond("災害時現場点検")},
    {"name": "差し戻す", "from": "TL承認待ち", "to": "差し戻し", "filterCond": ""},
    {"name": "承認する（GL・BL）", "from": "GL・BL承認待ち", "to": "確認済", "filterCond": ""},
    {"name": "差し戻す（GL・BL）", "from": "GL・BL承認待ち", "to": "差し戻し", "filterCond": ""},
    {"name": "再提出する（差し戻し後）", "from": "差し戻し", "to": "TL承認待ち", "filterCond": ""},
    {"name": "移行データ登録", "from": "未提出", "to": "確認済", "filterCond": 'report_id != ""'},
    {"name": "移行（TL承認待ち）", "from": "未提出", "to": "TL承認待ち", "filterCond": 'report_id != ""'},
    {"name": "移行（GL・BL承認待ち）", "from": "未提出", "to": "GL・BL承認待ち", "filterCond": 'report_id != ""'},
]})

# 安全旬報の提出時に安全検査室へ通知
send("PUT", "preview/app/notifications/perRecord.json", {"app": APP, "notifications": [
    {"filterCond": f'ステータス in ("TL承認待ち") and category = "安全旬報"', "title": "安全旬報が提出されました",
     "targets": [{"entity": {"type": "FIELD_ENTITY", "code": "safety_officer"}, "includeSubs": False}]}]})

# 一覧：「点検アプリ」（再現画面）と「一覧（レコード）」。自動作成の「（作業者が自分）」は残す
views = get("preview/app/views.json", app=APP)["views"]
keep = {k: v for k, v in views.items() if "作業者が自分" in k}
for v in keep.values():
    v["index"] = "2"
send("PUT", "preview/app/views.json", {"app": APP, "views": {**keep,
    "点検アプリ": {"type": "CUSTOM", "name": "点検アプリ", "index": "0", "pager": False, "html": '<div id="tenken-app"></div>'},
    "一覧（レコード）": {"type": "LIST", "name": "一覧（レコード）", "index": "1", "sort": "$id desc",
                        "fields": ["category", "project_no", "project_name", "inspector", "inspect_date", "ステータス", "作業者"]},
}})
deploy(APP)
print("done", APP)
