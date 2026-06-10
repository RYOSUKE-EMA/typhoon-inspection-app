import os
from datetime import datetime

from flask import Flask, render_template, request, redirect, url_for, send_file, abort
from io import BytesIO

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

# ── 点検項目（一般的な工事現場の台風養生チェック項目） ──────────────
CHECK_ITEMS = [
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
]

RESULT_OPTIONS = ["－", "対応済", "該当なし"]


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
        pending = fetchone(db_execute(conn, "SELECT COUNT(*) AS c FROM reports WHERE status=?", ("未確認",)))
        total = fetchone(db_execute(conn, "SELECT COUNT(*) AS c FROM reports"))
    finally:
        conn.close()
    return render_template("index.html", pending=pending["c"], total=total["c"])


# ── 点検報告：新規作成 ───────────────────────────────────────────
@app.route("/reports/new", methods=["GET", "POST"])
def new_report():
    if request.method == "POST":
        f = request.form
        project_name = f.get("project_name", "").strip()
        project_no = f.get("project_no", "").strip()
        inspect_datetime = f.get("inspect_datetime", "").strip()
        inspector = f.get("inspector", "").strip()

        conn = get_db()
        try:
            cur = db_execute(conn, """
                INSERT INTO reports (project_name, project_no, inspect_datetime, inspector, status, created_at)
                VALUES (?,?,?,?,?,?)
            """, (project_name, project_no, inspect_datetime, inspector, "未確認", datetime.now().isoformat(timespec="seconds")))
            if USE_PG:
                report_id = fetchone(db_execute(conn, "SELECT lastval() AS id"))["id"]
            else:
                report_id = cur.lastrowid

            for i, item_name in enumerate(CHECK_ITEMS):
                result = f.get(f"result_{i}", "－")
                note = f.get(f"note_{i}", "").strip()
                db_execute(conn, """
                    INSERT INTO report_items (report_id, item_name, result, note, sort_order)
                    VALUES (?,?,?,?,?)
                """, (report_id, item_name, result, note, i))
            conn.commit()
        finally:
            conn.close()
        return redirect(url_for("report_detail", report_id=report_id))

    now = datetime.now().strftime("%Y-%m-%dT%H:%M")
    return render_template("new_report.html", items=CHECK_ITEMS, options=RESULT_OPTIONS, now=now)


# ── 点検報告：一覧 ───────────────────────────────────────────────
@app.route("/reports")
def reports_list():
    conn = get_db()
    try:
        reports = fetchall(db_execute(conn, "SELECT * FROM reports ORDER BY id DESC"))
    finally:
        conn.close()
    return render_template("reports.html", reports=reports)


# ── 点検報告：詳細・上司確認 ──────────────────────────────────────
@app.route("/reports/<int:report_id>")
def report_detail(report_id):
    conn = get_db()
    try:
        report = fetchone(db_execute(conn, "SELECT * FROM reports WHERE id=?", (report_id,)))
        if not report:
            abort(404)
        items = fetchall(db_execute(conn, "SELECT * FROM report_items WHERE report_id=? ORDER BY sort_order", (report_id,)))
    finally:
        conn.close()
    return render_template("report_detail.html", report=report, items=items)


@app.route("/reports/<int:report_id>/approve", methods=["POST"])
def approve_report(report_id):
    f = request.form
    approver_name = f.get("approver_name", "").strip()
    approver_comment = f.get("approver_comment", "").strip()

    conn = get_db()
    try:
        report = fetchone(db_execute(conn, "SELECT * FROM reports WHERE id=?", (report_id,)))
        if not report:
            abort(404)
        db_execute(conn, """
            UPDATE reports SET status=?, approver_name=?, approver_comment=?, approved_at=?
            WHERE id=?
        """, ("確認済", approver_name, approver_comment, datetime.now().isoformat(timespec="seconds"), report_id))
        conn.commit()
    finally:
        conn.close()
    return redirect(url_for("report_detail", report_id=report_id))


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
    print("  台風養生点検アプリ 起動中")
    print("  ブラウザで http://localhost:5000 を開いてください")
    print("=" * 50)
    app.run(host="0.0.0.0", port=5000, debug=False)
