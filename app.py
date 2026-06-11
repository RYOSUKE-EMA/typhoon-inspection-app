import os
from datetime import datetime

from flask import Flask, render_template, request, redirect, url_for, send_file, abort
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer

pdfmetrics.registerFont(UnicodeCIDFont("HeiseiKakuGo-W5"))
pdfmetrics.registerFont(UnicodeCIDFont("HeiseiMin-W3"))

# ── DB設定（環境変数 DATABASE_URL があればPostgreSQL、なければSQLite） ──
DATABASE_URL = os.environ.get("DATABASE_URL", "")
USE_PG = DATABASE_URL.startswith("postgres")

if USE_PG:
    import psycopg2
    import psycopg2.extras
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
else:
    import sqlite3

app = Flask(__name__)

SQLITE_PATH = os.path.join(os.path.dirname(__file__), "typhoon.db")

# ── 点検種別ごとのチェック項目 ──────────────────────────────────────
INSPECTION_TYPES = {
    "typhoon": {
        "label": "台風養生点検",
        "icon": "🌀",
        "desc": "台風接近時の養生状況を点検します",
        "checklist": [
            "足場の補強・控え（ブレース）の設置状況",
            "足場の養生シート・メッシュシートの撤去または増し締め",
            "飛散防止ネットの状態確認",
            "クレーン・移動式クレーンのジブの格納・固定",
            "建設機械（重機）のアウトリガー固定・転倒防止",
            "仮設材・資材の固定または屋内・低所への格納",
            "仮設電気設備（分電盤・ケーブル等）の防水・浸水対策",
            "排水溝・側溝・釜場・ポンプの点検（詰まり除去・予備電源確認）",
            "開口部・ピット・マンホール等の蓋・養生確認",
            "法面・土留めのシート養生、土のう設置状況",
            "仮囲い・ゲート・出入口の固定確認",
            "看板・標識・サインボード・旗等の固定または撤去",
            "高所・足場上の不要物・仮置き資材の撤去",
            "車両・重機の安全な高台への移動",
            "照明設備・警報設備（警報サイレン等）の作動確認",
            "緊急連絡網・避難経路・避難場所の周知確認",
            "周辺家屋・通行人・歩行者への二次被害防止対策（飛来物等）",
            "仮設トイレ・休憩所等の固定・転倒防止",
        ],
    },
    "scaffold": {
        "label": "足場点検記録",
        "icon": "🪜",
        "desc": "足場の組立・変更後や強風後等の点検を行います（わく組足場・労働安全衛生規則対応）",
        "checklist": [
            "設計・計画時及び部材：足場の組立図を作成しているか",
            "設計・計画時及び部材：足場の建地の中心間の幅が60cm以上の場合、足場の後踏み側に「15cm以上で、できるだけ高い幅木」を設けているか",
            "設計・計画時及び部材：足場の後踏み側に「上桟」を設置しているか",
            "設計・計画時及び部材：建わく、床付き布わく、交さ筋かい等、ベース金具等の脚部、補強材等は計画通りか",
            "設計・計画時及び部材：部材（建わく、床付き布わく、交さ筋かい、緊結金具、脚柱ジョイント等）の損傷及び腐食がないか",
            "設計・計画時及び部材：足場部材として決められたものが使用されているか",
            "基礎：敷板、敷角等に沈下等の異常はないか",
            "基礎：ジャッキ型ベース金具は、敷板に釘止めされているか",
            "基礎：ジャッキ型ベース金具にゆるみはないか",
            "基礎：根がらみは所定の位置に直交型緊結金具で緊結されているか",
            "基礎：敷板に対し直角方向に根がらみは取り付けられているか",
            "建わく：躯体と建わくの設置間隔はよいか",
            "建わく：建わく脚柱は、アームロック、ピンロック等で固定されているか",
            "建わく：脚柱ジョイント、アームロックは、抜け止め防止がされているか",
            "交さ筋かい：交さ筋かいは全層、全スパンにわたってわく組の両面に取り付けられているか",
            "交さ筋かい：交さ筋かいピンは完全にロックされているか",
            "下桟及び上桟(より安全な措置)：高さ15～40cmの位置に下桟、及び上桟を設置しているか",
            "下桟及び上桟(より安全な措置)：建わくの脚柱等に固定されているか",
            "床付き布わく：床付き布わくは、幅40cm以上、隙間3cm以下、床材と建地との隙間は12cm未満となっているか",
            "床付き布わく：床付き布わくのつかみ金具は、外れ止めがロックされているか",
            "手すり（妻面）：妻面等には、床付き布わくから90cm(安衛則では85cm以上)以上の高さに手すり、高さ35cm～50cmの位置に中桟が設けられているか",
            "手すり先行工法の手すりわく等：手すりわくの取り付けは正しく行われているか",
            "手すり先行工法の手すりわく等：交さ筋かい併用の手すりわくの箇所には、交さ筋かいが取り付けられているか",
            "手すり先行工法の手すりわく等：手すりわくの下部には、幅木が取り付けられているか",
            "階段：階段わくのつかみ金具は、外れ止めがロックされているか",
            "階段：昇降部に手すり・中桟を取り付けてあるか",
            "階段：階段開口部に手すり、中桟を取り付けてあるか",
            "階段：階段を計画通り設置しているか、位置、数は適切か",
            "壁つなぎ又は控え：壁つなぎは水平方向8m以下、垂直方向9m以下の間隔で設置されているか",
            "壁つなぎ又は控え：壁つなぎに専用の壁つなぎ用金具が使用されているか",
            "壁つなぎ又は控え：壁つなぎは壁面に直角（15度以内）に付いているか",
            "壁つなぎ又は控え：控えは、緊結金具等により建わく脚柱に堅固に固定されているか",
            "壁つなぎ又は控え：壁つなぎ又は控えのアンカーは、十分な強度のあるところに固定されているか",
            "梁わく：梁わくを支持している建わくの補強は良いか",
            "梁わく：梁わくの支持部は異常ないか",
            "梁わく：梁わくには梁渡し等による補強がされているか",
            "層間安全ネット：計画通りの位置に設置されているか（２層以下）",
            "層間安全ネット：隙間なく有効に張られているか",
            "層間安全ネット：安全ネットは、持送りわく等につり綱等で確実に取り付けられているか",
            "落下物防止用：幅木(高さ10cm以上)、メッシュシート、防網は計画通りか",
            "幅木：幅木等は取り外されていないか",
            "幅木：幅木は脚柱に確実に取り付けられているか",
            "メッシュシート：メッシュシートは水平支持材に取り付け、すべてのはとめで緊結されているか",
            "防網：防網のつり綱は確実に緊結されているか",
            "渡りの設置：建物と足場間に設置されているか、また、不備はないか（位置・箇所・手すり等）",
            "安全帯取付設備等：安全帯を安全に取り付けるための設備等を設け、労働者に安全帯を使用させているか",
            "手すり等の取り外し：作業の必要上臨時に手すり等を取り外す場合、関係労働者以外の労働者を立ち入らせないこととしているか",
            "手すり等の取り外し：手すり等を取り外す必要がなくなった後、直ちに原状に戻しているか",
            "点検：作業開始前に、墜落防止設備に関する点検を実施しているか",
            "点検：足場の組立て等作業主任者であって、足場の組立等作業主任者能力向上教育を受講している者等の十分な知識、経験を有する者が点検しているか",
            "点検：強風、大雨、大雪等の悪天候若しくは中震以上の地震の後に点検し、異常を認めたときは、直ちに補修しているか",
            "その他：防護棚等の付帯設備の取り付けは問題ないか",
            "その他：最大積載荷重は表示されているか",
            "その他：特別教育を受けた労働者が足場の組立て等の業務を実施したか",
        ],
    },
    "safety_patrol": {
        "label": "安全旬報",
        "icon": "🦺",
        "desc": "現場の安全・環境管理状況を定期的に点検します（建築・マンション工事用旬報対応）",
        "checklist": [
            "危険個所の防護と標識の表示(仮囲い,架空線ﾊﾞﾘｹｰﾄﾞ,安全標識,夜間照明,赤灯等)",
            "路面の整正,路上の残材整備,飛来落下対策(排水,防塵,隣地道路への残材落下防止等)",
            "道路占用,道路使用の許可証確認／振動,騒音,特定元方作業開始届け出の確認",
            "交通規制及び車輌の誘導／歩行者安全対策,現場出入りの誘導",
            "工事看板,社旗,安全旗,労災成立票の掲示／現場内安全標識,足場ｽﾃｰｼﾞ積載荷重の掲示",
            "全工期安全工程表が作成され掲示してあるか／安全マニュアルが適切に運用されているか",
            "旬報提出（着手時及び決められた日）／日々の指示書による安全指示の実施と確認",
            "新規入場者の教育(もれなく行っているか)／ＲＫＹが適切に実施されているか（2項目以上）",
            "協力業者提出書類の有無(健康診断日･血圧)／労働者名簿は下請け,孫請け,末端まで記載",
            "現場事務所内掲示物の表示及び記入は良いか(施工体系図,緊急連絡先,緑十字等)",
            "作業主任者及び作業資格者の表示及び配置確認（複数の場合は全て記入）／特化、四アル鉛(ア－ク溶接)",
            "適正な保護具の着用(安全靴,ﾏｽｸ,ﾒｶﾞﾈ,耳栓等)／保安帽の着用,あごひもは緊結されているか",
            "主要作業の作業手順書が作成されているか",
            "災害防止協議会は定期に開催されているか",
            "消火器,防火用水(防火ﾊﾞｹﾂ)喫煙場所の確保は良いか(現場内に吸殻は落ちていないか)",
            "火元取扱責任者は決められているか(現場内焼却の禁止)",
            "溶接,溶断の対策及び後始末(溶接機の電撃防止装置,ﾎﾞﾝﾍﾞ類の保管方法は良いか)",
            "山留計画書の有無（安全な腹起し,切梁及び山留先行がされているか）",
            "安全な勾配で掘削しているか",
            "倒壊,崩壊防止及び排水対策良いか(落石等に対する防護及び監視人を含む)",
            "掘削開口部の転落防止措置(手摺り,ﾊﾞﾘｹｰﾄ)／床ピット,ｴﾚﾍﾞｰﾀｰｼｬﾌﾄ等開口部の措置共",
            "高所作業車の使用状況は良いか／高所作業車運転は資格者か",
            "上下作業原則禁止(合図の励行、物投下禁止,落下物受け対策)",
            "適切な玉掛けﾜｲﾔｰ等を使用しているか（損傷は無いか、適正な長さか、太さか）",
            "高所作業時の落下対策は良いか（親綱と墜落制止用器具の使用状況）",
            "取扱責任者の表示（分電盤,現場設置ｸﾚ-ﾝ,ｴﾚﾍﾞｰﾀｰ等)配電盤の施錠,ｱｰｽは適正か",
            "感電防止用漏電遮断装置は作動するか／溶接機の自動電撃防止装置は作動するか",
            "仮設配線状況と照明の(固定等）適否(損傷,配線状況,投光器,水銀灯等)",
            "活線、近接作業の防護（中電線、ＮＴＴ線有線等）中電線は中電依頼のこと",
            "電動工具の持込許可願いは出されているか／持込許可ｽﾃｯｶ-は貼っているか",
            "機械、機器の回転部の保護は良いか（丸のこ、ｻﾝﾀﾞ-、左官ﾐｷｻ-）",
            "車両系建設機械整備点検状況（点検状況のﾁｪｯｸ)／持込機械許可願いの発行と確認",
            "ｳｨﾝﾁは専用金具又はﾁｴ-ﾝで固定されているか（ﾜｲﾔ-のｷﾝｸは無いか、離脱防止ﾌｯｸは不良で無いか）",
            "移動式ｸﾚｰﾝの設置状況は良いか(平坦地)／ｱｳﾄﾘ-ｶﾞ-の位置,ﾛｯｸﾋﾟﾝ,ﾌｯｸの離脱防止,過巻き防止等",
            "休止中の状況適否(重機,ﾘﾌﾄ,施錠等)及び旋回半径内立入禁止措置良いか又は監視人を設置しているか",
            "ＫＹ状況・重機点検状況・クレ－ンモ－ド／回転灯の使用状況",
            "過積載防止対策の励行",
            "用途外使用は行っていないか",
            "重機の死角確認が適切か（サイドミラ－等の向き、破損）",
            "足場架設の良否と足場上の障害物の有無(沈下防止,壁つなぎ,筋違い,巾木,手摺等)／足場設置の届出(高さ10m以上,吊り足場等)",
            "足場躯体の間隔及びコーナー(30㎝以内)の隙間は空いていないか／足場から躯体への連絡通路は適切か",
            "足場,ｽﾃｰｼﾞからの墜落防止措置は良いか",
            "作業床40㎝以上確保されているか(道板の場合は二枚並べ）／立馬の適切な使用",
            "はね出し足場及び覆いの設置は良いか(アサガオ,シート等）",
            "移動用足場（ローリングタワー）の昇降設備,最上段の手摺り,安全帯等",
            "昇降設備の安全対策（踊り場及び廻りの手摺,梯子の固定突出,階段勾配,ｽﾛｰﾌﾟ勾配)",
            "脚立足場使用良いか(三点支持,二枚重,結束)／脚立の最上段に立って使用していないか",
            "吊り足場の安全対策良いか(固定、動揺防止)／安全ネット設置良いか（隙間、結束）",
            "足場使用者による作業開始前点検の実施",
            "転位,滑動,沈下防止,ｻﾎﾟｰﾄ専用ﾋﾟﾝ,支柱の水平つなぎ（高さ３.5ｍ以上）",
            "組立図の作成及び届出(高さ３.5ｍ以上）",
            "現場内の整理整頓(事務所,休憩所,便所)及び清掃／安全通路の確保、運搬通路の確保、駐車状況",
            "産業廃棄物等の分別集積は良いか、保管場所の掲示はされているか",
            "マニュフェストが適切に処理されているか",
            "（事業継続計画）緊急事態への対応要領が保管、掲示等がされているか",
            "注文書のリサイクル法該当欄に有無の記入（二次下請けも）",
            "ＳＤＳ（安全デ－タシ－ト）の周知／化学物質のリスクアセスメント実施",
            "建退共・社会保険の加入",
            "自家用電気工作物に係る保安規制（可搬型発電機）",
            "排ガス対策機械の使用",
        ],
    },
}

RESULT_OPTIONS = ["－", "対応済", "該当なし"]


def get_inspection_type(category):
    info = INSPECTION_TYPES.get(category)
    if not info:
        abort(404)
    return info


# ── DB接続 ───────────────────────────────────────────────────────
def get_db():
    if USE_PG:
        return psycopg2.connect(DATABASE_URL)
    else:
        conn = sqlite3.connect(SQLITE_PATH)
        conn.row_factory = sqlite3.Row
        return conn


def db_execute(conn, sql, params=()):
    if USE_PG:
        sql = sql.replace("?", "%s")
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, params)
        return cur
    else:
        return conn.execute(sql, params)


def fetchall(cur):
    return cur.fetchall()


def fetchone(cur):
    return cur.fetchone()


def init_db():
    conn = get_db()
    try:
        if USE_PG:
            cur = conn.cursor()
            cur.execute("""
            CREATE TABLE IF NOT EXISTS reports (
                id SERIAL PRIMARY KEY,
                category TEXT NOT NULL DEFAULT 'typhoon',
                project_name TEXT NOT NULL,
                project_no TEXT,
                inspect_datetime TEXT NOT NULL,
                inspector TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT '未確認',
                approver_name TEXT,
                approver_comment TEXT,
                approved_at TEXT,
                created_at TEXT NOT NULL
            )""")
            cur.execute("ALTER TABLE reports ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'typhoon'")
            cur.execute("""
            CREATE TABLE IF NOT EXISTS report_items (
                id SERIAL PRIMARY KEY,
                report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
                item_name TEXT NOT NULL,
                result TEXT NOT NULL DEFAULT '－',
                note TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0
            )""")
            cur.execute("""
            CREATE TABLE IF NOT EXISTS resources (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                filename TEXT NOT NULL,
                mimetype TEXT,
                data BYTEA NOT NULL,
                uploaded_by TEXT,
                uploaded_at TEXT NOT NULL
            )""")
            conn.commit()
        else:
            conn.executescript("""
            CREATE TABLE IF NOT EXISTS reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL DEFAULT 'typhoon',
                project_name TEXT NOT NULL,
                project_no TEXT,
                inspect_datetime TEXT NOT NULL,
                inspector TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT '未確認',
                approver_name TEXT,
                approver_comment TEXT,
                approved_at TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS report_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                report_id INTEGER NOT NULL,
                item_name TEXT NOT NULL,
                result TEXT NOT NULL DEFAULT '－',
                note TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (report_id) REFERENCES reports(id)
            );
            CREATE TABLE IF NOT EXISTS resources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                filename TEXT NOT NULL,
                mimetype TEXT,
                data BLOB NOT NULL,
                uploaded_by TEXT,
                uploaded_at TEXT NOT NULL
            );
            """)
            cols = [r[1] for r in conn.execute("PRAGMA table_info(reports)").fetchall()]
            if "category" not in cols:
                conn.execute("ALTER TABLE reports ADD COLUMN category TEXT NOT NULL DEFAULT 'typhoon'")
    finally:
        conn.close()


def to_bytes(data):
    if data is None:
        return b""
    if isinstance(data, memoryview):
        return data.tobytes()
    return bytes(data)


# ── トップページ ─────────────────────────────────────────────────
@app.route("/")
def index():
    conn = get_db()
    try:
        counts = {}
        for category in INSPECTION_TYPES:
            row = fetchone(db_execute(conn, "SELECT COUNT(*) AS c FROM reports WHERE category=? AND status=?", (category, "未確認")))
            counts[category] = row["c"]
    finally:
        conn.close()
    return render_template("index.html", types=INSPECTION_TYPES, counts=counts)


# ── 点検報告：新規作成 ───────────────────────────────────────────
@app.route("/reports/<category>/new", methods=["GET", "POST"])
def new_report(category):
    info = get_inspection_type(category)

    if request.method == "POST":
        f = request.form
        project_name = f.get("project_name", "").strip()
        project_no = f.get("project_no", "").strip()
        inspect_datetime = f.get("inspect_datetime", "").strip()
        inspector = f.get("inspector", "").strip()

        conn = get_db()
        try:
            cur = db_execute(conn, """
                INSERT INTO reports (category, project_name, project_no, inspect_datetime, inspector, status, created_at)
                VALUES (?,?,?,?,?,?,?)
            """, (category, project_name, project_no, inspect_datetime, inspector, "未確認", datetime.now().isoformat(timespec="seconds")))
            if USE_PG:
                report_id = fetchone(db_execute(conn, "SELECT lastval() AS id"))["id"]
            else:
                report_id = cur.lastrowid

            for i, item_name in enumerate(info["checklist"]):
                result = f.get(f"result_{i}", "－")
                note = f.get(f"note_{i}", "").strip()
                db_execute(conn, """
                    INSERT INTO report_items (report_id, item_name, result, note, sort_order)
                    VALUES (?,?,?,?,?)
                """, (report_id, item_name, result, note, i))
            conn.commit()
        finally:
            conn.close()
        return redirect(url_for("report_detail", category=category, report_id=report_id))

    now = datetime.now().strftime("%Y-%m-%dT%H:%M")
    return render_template("new_report.html", category=category, info=info, options=RESULT_OPTIONS, now=now)


# ── 点検報告：一覧 ───────────────────────────────────────────────
@app.route("/reports/<category>")
def reports_list(category):
    info = get_inspection_type(category)
    conn = get_db()
    try:
        reports = fetchall(db_execute(conn, "SELECT * FROM reports WHERE category=? ORDER BY id DESC", (category,)))
    finally:
        conn.close()
    return render_template("reports.html", category=category, info=info, reports=reports)


# ── 点検報告：詳細・上司確認 ──────────────────────────────────────
@app.route("/reports/<category>/<int:report_id>")
def report_detail(category, report_id):
    info = get_inspection_type(category)
    conn = get_db()
    try:
        report = fetchone(db_execute(conn, "SELECT * FROM reports WHERE id=? AND category=?", (report_id, category)))
        if not report:
            abort(404)
        items = fetchall(db_execute(conn, "SELECT * FROM report_items WHERE report_id=? ORDER BY sort_order", (report_id,)))
    finally:
        conn.close()
    return render_template("report_detail.html", category=category, info=info, report=report, items=items)


@app.route("/reports/<category>/<int:report_id>/pdf")
def report_pdf(category, report_id):
    info = get_inspection_type(category)
    conn = get_db()
    try:
        report = fetchone(db_execute(conn, "SELECT * FROM reports WHERE id=? AND category=?", (report_id, category)))
        if not report:
            abort(404)
        items = fetchall(db_execute(conn, "SELECT * FROM report_items WHERE report_id=? ORDER BY sort_order", (report_id,)))
    finally:
        conn.close()

    styles = getSampleStyleSheet()
    base_style = ParagraphStyle("jp", parent=styles["Normal"], fontName="HeiseiMin-W3", fontSize=9, leading=12)
    title_style = ParagraphStyle("jpTitle", parent=styles["Heading1"], fontName="HeiseiKakuGo-W5", fontSize=16, leading=20)
    head_style = ParagraphStyle("jpHead", parent=styles["Heading2"], fontName="HeiseiKakuGo-W5", fontSize=11, leading=14)

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=15 * mm, bottomMargin=15 * mm, leftMargin=15 * mm, rightMargin=15 * mm,
    )

    elements = []
    elements.append(Paragraph(f"{info['icon']} {info['label']}", title_style))
    elements.append(Spacer(1, 6))

    status_label = "確認済" if report["status"] == "確認済" else "確認待ち"
    info_table = Table([
        ["工事名", Paragraph(report["project_name"] or "", base_style), "工事ナンバー", Paragraph(report["project_no"] or "", base_style)],
        ["点検日時", Paragraph((report["inspect_datetime"] or "").replace("T", " "), base_style), "点検者", Paragraph(report["inspector"] or "", base_style)],
        ["状態", Paragraph(status_label, base_style), "", ""],
    ], colWidths=[28 * mm, 65 * mm, 28 * mm, 65 * mm])
    info_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "HeiseiKakuGo-W5"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eeeeee")),
        ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#eeeeee")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("SPAN", (1, 2), (3, 2)),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 10))

    elements.append(Paragraph("点検項目", head_style))
    elements.append(Spacer(1, 4))

    table_data = [["No", "点検項目", "結果", "備考"]]
    for idx, item in enumerate(items, start=1):
        table_data.append([
            str(idx),
            Paragraph(item["item_name"] or "", base_style),
            item["result"] or "",
            Paragraph(item["note"] or "", base_style),
        ])
    item_table = Table(table_data, colWidths=[10 * mm, 110 * mm, 18 * mm, 48 * mm], repeatRows=1)
    item_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), "HeiseiKakuGo-W5"),
        ("FONTNAME", (0, 1), (0, -1), "HeiseiMin-W3"),
        ("FONTNAME", (2, 1), (2, -1), "HeiseiMin-W3"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dddddd")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (2, 0), (2, -1), "CENTER"),
    ]))
    elements.append(item_table)
    elements.append(Spacer(1, 10))

    elements.append(Paragraph("上司確認欄", head_style))
    elements.append(Spacer(1, 4))
    if report["status"] == "確認済":
        approve_table = Table([
            ["確認者", Paragraph(report["approver_name"] or "", base_style)],
            ["確認日時", Paragraph((report["approved_at"] or "").replace("T", " "), base_style)],
            ["コメント", Paragraph(report["approver_comment"] or "", base_style)],
        ], colWidths=[28 * mm, 158 * mm])
    else:
        approve_table = Table([
            ["確認者", ""],
            ["確認日時", ""],
            ["コメント", ""],
        ], colWidths=[28 * mm, 158 * mm], rowHeights=[8 * mm, 8 * mm, 8 * mm])
    approve_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "HeiseiKakuGo-W5"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eeeeee")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    elements.append(approve_table)

    doc.build(elements)
    buf.seek(0)

    filename = f"{info['label']}_{report['project_name']}_{report_id}.pdf"
    return send_file(
        buf,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename,
    )


@app.route("/reports/<category>/<int:report_id>/approve", methods=["POST"])
def approve_report(category, report_id):
    get_inspection_type(category)
    f = request.form
    approver_name = f.get("approver_name", "").strip()
    approver_comment = f.get("approver_comment", "").strip()

    conn = get_db()
    try:
        report = fetchone(db_execute(conn, "SELECT * FROM reports WHERE id=? AND category=?", (report_id, category)))
        if not report:
            abort(404)
        db_execute(conn, """
            UPDATE reports SET status=?, approver_name=?, approver_comment=?, approved_at=?
            WHERE id=?
        """, ("確認済", approver_name, approver_comment, datetime.now().isoformat(timespec="seconds"), report_id))
        conn.commit()
    finally:
        conn.close()
    return redirect(url_for("report_detail", category=category, report_id=report_id))


# ── 資料集 ───────────────────────────────────────────────────────
@app.route("/resources")
def resources_list():
    conn = get_db()
    try:
        resources = fetchall(db_execute(conn, "SELECT id, title, description, filename, uploaded_by, uploaded_at FROM resources ORDER BY id DESC"))
    finally:
        conn.close()
    return render_template("resources.html", resources=resources)


@app.route("/resources/upload", methods=["POST"])
def upload_resource():
    f = request.form
    title = f.get("title", "").strip()
    description = f.get("description", "").strip()
    uploaded_by = f.get("uploaded_by", "").strip()
    file = request.files.get("file")

    if title and file and file.filename:
        data = file.read()
        conn = get_db()
        try:
            db_execute(conn, """
                INSERT INTO resources (title, description, filename, mimetype, data, uploaded_by, uploaded_at)
                VALUES (?,?,?,?,?,?,?)
            """, (title, description, file.filename, file.mimetype,
                  psycopg2.Binary(data) if USE_PG else sqlite3.Binary(data),
                  uploaded_by, datetime.now().isoformat(timespec="seconds")))
            conn.commit()
        finally:
            conn.close()
    return redirect(url_for("resources_list"))


@app.route("/resources/<int:resource_id>/download")
def download_resource(resource_id):
    conn = get_db()
    try:
        res = fetchone(db_execute(conn, "SELECT * FROM resources WHERE id=?", (resource_id,)))
    finally:
        conn.close()
    if not res:
        abort(404)
    return send_file(
        BytesIO(to_bytes(res["data"])),
        mimetype=res["mimetype"] or "application/octet-stream",
        as_attachment=False,
        download_name=res["filename"],
    )


@app.route("/resources/<int:resource_id>/delete", methods=["POST"])
def delete_resource(resource_id):
    conn = get_db()
    try:
        db_execute(conn, "DELETE FROM resources WHERE id=?", (resource_id,))
        conn.commit()
    finally:
        conn.close()
    return redirect(url_for("resources_list"))


# 起動時に必ずDB初期化（gunicorn経由でも動作するよう__main__の外に配置）
init_db()

if __name__ == "__main__":
    print("=" * 50)
    print("  現場点検システム 起動中")
    print("  ブラウザで http://localhost:5000 を開いてください")
    print("=" * 50)
    app.run(host="0.0.0.0", port=5000, debug=False)
