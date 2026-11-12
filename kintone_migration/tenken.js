/*
 * 台風養生点検・災害時現場点検・足場点検記録（kintone版）共通カスタマイズ
 *  - 新規作成：点検項目の自動展開（共通設定アプリ）、前回入力のプレフィル、保存＝提出（承認ありの点検のみ）
 *  - 足場：足場の種類で点検項目を切替、点検実施理由「その他」は内容必須
 *  - 差し戻し：理由入力（任意）／承認：承認記録（自動）に承認者と日時を追記
 *  - 解説：点検項目の手引き（説明文・参考画像）を表示
 *  - PDF出力、足場の提出状況（現場×日付カレンダー）
 * 依存：pdf-lib.min.js / fontkit.umd.min.js
 */
(function () {
  'use strict';

  var TENKEN_CONF = 5831;   // 点検 共通設定（点検項目・手引き）
  var JUNPO_CONF = 5830;    // 安全旬報 設定（PDF資材・対象期間・追加対象を共用）
  var MASTER_APP = 269;
  var APPS = {
    5832: { label: '台風養生点検', approval: true },
    5833: { label: '災害時現場点検', approval: true },
    5834: { label: '足場点検記録', approval: false, scaffold: true }
  };
  var LEGEND = '○…異常なし　×…不備あり　－…該当なし　（不備ありの場合は備考欄に処置内容を記載）';

  function isMobile() { return location.pathname.indexOf('/k/m/') === 0; }
  function appId() { return isMobile() ? kintone.mobile.app.getId() : kintone.app.getId(); }
  var CFG = APPS[appId()];
  if (!CFG) return;

  function api(path, method, body) { return kintone.api(kintone.api.url(path, true), method, body); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function userNames(v) { return (v || []).map(function (u) { return u.name; }).join('、'); }
  function fetchAll(app, query, fields) {
    var out = [];
    function next(lastId) {
      var params = { app: app, query: (query ? '(' + query + ') and ' : '') + '$id > ' + lastId + ' order by $id asc limit 500' };
      if (fields) params.fields = fields.concat(['$id']);
      return api('/k/v1/records', 'GET', params).then(function (r) {
        out = out.concat(r.records);
        return r.records.length === 500 ? next(r.records[r.records.length - 1].$id.value) : out;
      });
    }
    return next(0);
  }
  function setShown(code, show) {
    try {
      if (isMobile()) kintone.mobile.app.record.setFieldShown(code, show);
      else kintone.app.record.setFieldShown(code, show);
    } catch (e) { /* 無視 */ }
  }
  function headerSpace(onRecord) {
    if (isMobile()) return onRecord ? kintone.mobile.app.record.getHeaderSpaceElement() : kintone.mobile.app.getHeaderSpaceElement();
    return onRecord ? kintone.app.record.getHeaderMenuSpaceElement() : kintone.app.getHeaderMenuSpaceElement();
  }

  // ───────── 共通設定（点検項目・手引き） ─────────
  var confCache = null;
  function loadConf() {
    if (!confCache) confCache = fetchAll(TENKEN_CONF, 'category in ("' + CFG.label + '")', null);
    return confCache;
  }
  function loadItems(subtype) {
    return loadConf().then(function (recs) {
      var r = recs.filter(function (x) {
        return x.kind.value === '点検項目' && (x.subtype.value || '') === (subtype || '');
      })[0];
      return r ? r.body.value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean) : [];
    });
  }
  function rowsFor(items) {
    return items.map(function (name, i) {
      return { value: {
        item_no: { type: 'NUMBER', value: String(i + 1), disabled: true },
        item_name: { type: 'SINGLE_LINE_TEXT', value: name, disabled: true },
        result: { type: 'DROP_DOWN', value: '' },
        note: { type: 'SINGLE_LINE_TEXT', value: '' }
      } };
    });
  }
  function lockRows(rec) {
    (rec.checklist.value || []).forEach(function (row) {
      row.value.item_no.disabled = true;
      row.value.item_name.disabled = true;
    });
  }

  // ───────── 新規作成・編集 ─────────
  var ev = function (names) { return names.concat(names.map(function (n) { return 'mobile.' + n; })); };

  kintone.events.on(ev(['app.record.create.show']), function (event) {
    var rec = event.record;
    ['legacy_id', 'legacy_note', 'return_reason', 'approval_log'].forEach(function (c) { if (rec[c]) setShown(c, false); });
    if (CFG.scaffold) setShown('inspect_reason_other', false);
    var me = kintone.getLoginUser();
    var fields = ['koji_no'];
    ['approver_tl', 'approver_gl', 'approver_bl', 'assembler_name', 'assembler_qual', 'assembler_qual_no',
     'inspector_qual', 'inspector_qual_no', 'subtype'].forEach(function (c) { if (rec[c]) fields.push(c); });
    return Promise.all([
      api('/k/v1/records', 'GET', { app: appId(), query: '作成者 in ("' + me.code + '") order by $id desc limit 1', fields: fields }),
      CFG.scaffold ? Promise.resolve([]) : loadItems('')
    ]).then(function (res) {
      var last = res[0].records[0];
      if (last && !rec.koji_no.value) {
        fields.forEach(function (c) { if (c !== 'koji_no' && rec[c]) rec[c].value = last[c].value; });
        rec.koji_no.value = last.koji_no.value;
        rec.koji_no.lookup = true;
      }
      if (CFG.scaffold) {
        if (rec.subtype.value) return loadItems(rec.subtype.value).then(function (items) { rec.checklist.value = rowsFor(items); return event; });
        return event;   // 足場の種類を選ぶと点検項目が入る
      }
      rec.checklist.value = rowsFor(res[1]);
      return event;
    }).catch(function (e) { console.error(e); return event; });
  });

  kintone.events.on(ev(['app.record.edit.show']), function (event) {
    lockRows(event.record);
    if (!event.record.legacy_id.value) { setShown('legacy_id', false); setShown('legacy_note', false); }
    if (CFG.scaffold) setShown('inspect_reason_other', event.record.inspect_reason.value === 'その他');
    return event;
  });

  if (CFG.scaffold) {
    // 足場の種類を変えたら点検項目を入れ替え
    kintone.events.on(ev(['app.record.create.change.subtype', 'app.record.edit.change.subtype']), function (event) {
      var rec = event.record;
      var entered = (rec.checklist.value || []).some(function (r) { return r.value.result.value; });
      if (entered && !window.confirm('足場の種類を変えると、入力済みの点検結果が消えます。よろしいですか？')) {
        return event;  // 種類だけ変わり、項目は残る（保存前に戻せる）
      }
      return loadItems(rec.subtype.value).then(function (items) {
        rec.checklist.value = rowsFor(items);
        return event;
      });
    });
    kintone.events.on(ev(['app.record.create.change.inspect_reason', 'app.record.edit.change.inspect_reason']), function (event) {
      var other = event.record.inspect_reason.value === 'その他';
      setShown('inspect_reason_other', other);
      if (!other) event.record.inspect_reason_other.value = '';
      return event;
    });
    kintone.events.on(ev(['app.record.create.submit', 'app.record.edit.submit']), function (event) {
      var rec = event.record;
      if (rec.inspect_reason.value === 'その他' && !(rec.inspect_reason_other.value || '').trim()) {
        rec.inspect_reason_other.error = '「その他」を選んだときは内容を入力してください';
        event.error = '点検実施理由（その他の内容）を入力してください';
      }
      if (!(rec.checklist.value || []).length) event.error = '足場の種類を選んで点検項目を表示してください';
      return event;
    });
  }

  // 保存＝提出（承認ありの点検）
  if (CFG.approval) {
    kintone.events.on(ev(['app.record.create.submit.success']), function (event) {
      return api('/k/v1/record/status', 'PUT', { app: appId(), id: event.recordId, action: '提出する' })
        .then(function () { return event; })
        .catch(function (e) {
          alert('保存しましたが、提出（TLへの通知）に失敗しました。レコード画面の「提出する」ボタンを押してください。\n' + ((e && e.message) || ''));
          return event;
        });
    });

    kintone.events.on(ev(['app.record.detail.process.proceed']), function (event) {
      var act = event.action.value;
      var rec = event.record;
      var me = kintone.getLoginUser();
      var stamp = iso(new Date()) + ' ' + pad(new Date().getHours()) + ':' + pad(new Date().getMinutes());
      if (act.indexOf('差し戻す') === 0) {
        var reason = window.prompt('差し戻し理由を入力してください（空欄のままでも差し戻せます）', '');
        if (reason === null) return false;
        rec.return_reason.value = reason;
        rec.approval_log.value = (rec.approval_log.value ? rec.approval_log.value + '\n' : '') +
          '差し戻し：' + me.name + '　' + stamp + (reason ? '　理由：' + reason : '');
      } else if (act.indexOf('承認する') === 0) {
        var role = act === '承認する（GL・BL）' ? 'GL・BL' : 'TL';
        rec.approval_log.value = (rec.approval_log.value ? rec.approval_log.value + '\n' : '') +
          role + '承認：' + me.name + '　' + stamp;
      } else if (act.indexOf('再提出') === 0) {
        rec.approval_log.value = (rec.approval_log.value ? rec.approval_log.value + '\n' : '') + '再提出：' + me.name + '　' + stamp;
      }
      return event;
    });
  }

  // ───────── 詳細・入力画面のボタン ─────────
  kintone.events.on(ev(['app.record.detail.show']), function (event) {
    var rec = event.record;
    if (!rec.legacy_id.value) { setShown('legacy_id', false); setShown('legacy_note', false); }
    if (rec.return_reason && !rec.return_reason.value) setShown('return_reason', false);
    if (CFG.scaffold && rec.inspect_reason.value !== 'その他') setShown('inspect_reason_other', false);
    var sp = headerSpace(true);
    if (!sp || sp.querySelector('.tk-btns')) return event;
    var box = document.createElement('span');
    box.className = 'tk-btns';
    box.appendChild(button('PDF出力', function (b) {
      busy(b, buildPdf(rec).then(function (bytes) { saveBytes(bytes, pdfName(rec)); }));
    }));
    box.appendChild(button('点検項目の解説', function () { showGuides(rec); }));
    sp.appendChild(box);
    return event;
  });

  kintone.events.on(ev(['app.record.create.show', 'app.record.edit.show']), function (event) {
    var sp = headerSpace(true);
    if (sp && !sp.querySelector('.tk-btns')) {
      var box = document.createElement('span');
      box.className = 'tk-btns';
      box.appendChild(button('点検項目の解説', function () {
        var r = isMobile() ? kintone.mobile.app.record.get().record : kintone.app.record.get().record;
        showGuides(r);
      }));
      sp.appendChild(box);
    }
    return event;
  });

  function button(label, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tk-btn';
    b.textContent = label;
    b.onclick = function () { onClick(b); };
    return b;
  }
  function busy(b, p) {
    var t = b.textContent;
    b.disabled = true;
    b.textContent = '作成中...';
    return p.catch(function (e) { console.error(e); alert('処理に失敗しました：' + ((e && e.message) || e)); })
      .then(function () { b.disabled = false; b.textContent = t; });
  }

  // ───────── 解説（手引き） ─────────
  function downloadFile(fileKey) {
    return fetch(kintone.api.url('/k/v1/file', true) + '?fileKey=' + encodeURIComponent(fileKey), {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin'
    }).then(function (r) {
      if (!r.ok) throw new Error('ファイルの取得に失敗しました（' + r.status + '）');
      return r.blob();
    });
  }

  function showGuides(rec) {
    var subtype = CFG.scaffold ? (rec.subtype.value || '') : '';
    var names = (rec.checklist.value || []).map(function (r) { return r.value.item_name.value; });
    var ov = document.createElement('div');
    ov.className = 'tk-modal';
    ov.innerHTML = '<div class="tk-box"><div class="tk-head"><b>点検項目の解説</b><button type="button" class="tk-btn tk-close">閉じる</button></div><div class="tk-body">読み込み中...</div></div>';
    document.body.appendChild(ov);
    ov.onclick = function (e) { if (e.target === ov || e.target.classList.contains('tk-close')) ov.remove(); };
    var body = ov.querySelector('.tk-body');
    confCache = null;
    loadConf().then(function (recs) {
      var guides = recs.filter(function (g) { return g.kind.value === '手引き' && (g.subtype.value || '') === subtype; });
      guides.sort(function (a, b) { return names.indexOf(a.item_name.value) - names.indexOf(b.item_name.value); });
      if (!guides.length) { body.innerHTML = '<p>この点検の解説はまだ登録されていません。共通設定アプリ（点検 共通設定）で「手引き」を登録すると表示されます。</p>'; return; }
      body.innerHTML = guides.map(function (g, i) {
        var no = names.indexOf(g.item_name.value);
        return '<div class="tk-guide"><div class="tk-gt">' + (no >= 0 ? (no + 1) + '. ' : '') + esc(g.item_name.value) + '</div>' +
          '<div class="tk-gd">' + esc(g.body.value).replace(/\n/g, '<br>') + '</div><div class="tk-gi" data-i="' + i + '"></div></div>';
      }).join('');
      guides.forEach(function (g, i) {
        var holder = body.querySelector('.tk-gi[data-i="' + i + '"]');
        (g.images.value || []).forEach(function (f) {
          downloadFile(f.fileKey).then(function (blob) {
            var img = document.createElement('img');
            img.src = URL.createObjectURL(blob);
            img.onclick = function () { window.open(img.src, '_blank'); };
            holder.appendChild(img);
          }).catch(function (e) { console.error(e); });
        });
      });
    }).catch(function (e) { body.textContent = '読み込みに失敗しました：' + ((e && e.message) || e); });
  }

  // ───────── PDF（A4縦の表形式） ─────────
  var assetCache = null;
  function loadFont() {
    if (assetCache) return assetCache;
    assetCache = api('/k/v1/records', 'GET', { app: JUNPO_CONF, query: 'kind in ("PDF資材") limit 1' }).then(function (r) {
      var f = r.records[0] && r.records[0].files.value.filter(function (x) { return /\.(ttf|otf)$/i.test(x.name); })[0];
      if (!f) throw new Error('PDF用フォントが見つかりません（安全旬報 設定アプリの「PDF資材」）');
      return downloadFile(f.fileKey).then(function (b) { return b.arrayBuffer(); });
    });
    assetCache.catch(function () { assetCache = null; });
    return assetCache;
  }

  function pdfName(rec) {
    return rec.koji_no.value + '_' + CFG.label + '_' + (rec.inspect_date.value || '').replace(/-/g, '') + '.pdf';
  }

  function wrap(font, text, size, width) {
    var lines = [];
    String(text || '').split(/\r?\n/).forEach(function (para) {
      var line = '';
      for (var i = 0; i < para.length; i++) {
        if (font.widthOfTextAtSize(line + para[i], size) > width && line) { lines.push(line); line = ''; }
        line += para[i];
      }
      lines.push(line);
    });
    return lines;
  }

  function buildPdf(rec) {
    var PDFLib = window.PDFLib;
    if (!PDFLib || !window.fontkit) return Promise.reject(new Error('PDFライブラリが読み込まれていません'));
    return Promise.all([loadFont(), PDFLib.PDFDocument.create()]).then(function (res) {
      var doc = res[1];
      doc.registerFontkit(window.fontkit);
      return doc.embedFont(res[0], { subset: false }).then(function (font) {
        var W = 595.28, H = 841.89, M = 36, black = PDFLib.rgb(0, 0, 0), gray = PDFLib.rgb(0.45, 0.45, 0.45);
        var line = PDFLib.rgb(0.6, 0.6, 0.6), fill = PDFLib.rgb(0.94, 0.95, 0.96);
        var page, y;
        function newPage() { page = doc.addPage([W, H]); y = H - M; }
        function txt(t, x, yy, s, c) { if (t) page.drawText(String(t), { x: x, y: yy, size: s, font: font, color: c || black }); }
        function box(x, yy, w, h, f) { page.drawRectangle({ x: x, y: yy, width: w, height: h, borderColor: line, borderWidth: 0.6, color: f || undefined }); }
        newPage();
        var title = CFG.label + (CFG.scaffold && rec.subtype.value ? '（' + rec.subtype.value + '）' : '');
        txt(title, (W - font.widthOfTextAtSize(title, 16)) / 2, y - 16, 16);
        y -= 34;

        // 基本情報（ラベル｜値｜ラベル｜値）
        var info = [['工事名', rec.koji_name.value, '工事番号', rec.koji_no.value],
                    ['点検日', rec.inspect_date.value, '点検者', userNames(rec.inspector.value)]];
        if (CFG.scaffold) {
          var reason = rec.inspect_reason.value === 'その他' ? 'その他（' + (rec.inspect_reason_other.value || '') + '）' : rec.inspect_reason.value;
          var q = function (n, no) { return (n || '') + (no ? '（資格番号：' + no + '）' : ''); };
          info.push(['点検実施理由', reason, '組立者', rec.assembler_name.value]);
          info.push(['点検者の資格', q(rec.inspector_qual.value, rec.inspector_qual_no.value), '組立者の資格', q(rec.assembler_qual.value, rec.assembler_qual_no.value)]);
        }
        if (rec['ステータス']) info.push(['状態', rec['ステータス'].value, '', '']);
        var lw = 70, vw = (W - 2 * M - 2 * lw) / 2;
        info.forEach(function (r) {
          var l1 = wrap(font, r[1], 9, vw - 8), l3 = wrap(font, r[3], 9, vw - 8);
          var h = Math.max(l1.length, l3.length) * 12 + 8;
          var x = M;
          [[lw, r[0], true], [vw, l1, false], [lw, r[2], true], [vw, l3, false]].forEach(function (c) {
            box(x, y - h, c[0], h, c[2] ? fill : null);
            var ls = c[2] ? [c[1]] : c[1];
            ls.forEach(function (t, i) { txt(t, x + 4, y - 13 - i * 12, 9); });
            x += c[0];
          });
          y -= h;
        });
        y -= 10;
        txt(LEGEND, M, y - 9, 8, gray);
        y -= 18;

        // 点検項目
        var cols = [26, 300, 40, W - 2 * M - 366];
        function head() {
          var x = M;
          ['No', '点検項目', '結果', '備考'].forEach(function (t, i) {
            box(x, y - 18, cols[i], 18, fill);
            txt(t, x + (i === 0 || i === 2 ? (cols[i] - font.widthOfTextAtSize(t, 9)) / 2 : 4), y - 13, 9);
            x += cols[i];
          });
          y -= 18;
        }
        head();
        (rec.checklist.value || []).forEach(function (row, idx) {
          var name = wrap(font, row.value.item_name.value, 9, cols[1] - 8);
          var note = wrap(font, row.value.note.value, 8.5, cols[3] - 8);
          var h = Math.max(name.length, note.length) * 12 + 8;
          if (y - h < M + 20) { newPage(); head(); }
          var x = M;
          var res = row.value.result.value || '';
          [[String(idx + 1), true], [name, false], [res, true], [note, false]].forEach(function (c, i) {
            box(x, y - h, cols[i], h);
            if (c[1]) txt(c[0], x + (cols[i] - font.widthOfTextAtSize(c[0], 10)) / 2, y - 14, 10);
            else c[0].forEach(function (t, k) { txt(t, x + 4, y - 13 - k * 12, i === 3 ? 8.5 : 9); });
            x += cols[i];
          });
          y -= h;
        });

        // 承認記録
        var log = (rec.approval_log && rec.approval_log.value) || '';
        var legacy = rec.legacy_note.value || '';
        var tail = [log, legacy].filter(Boolean).join('\n');
        if (tail) {
          var ls = wrap(font, tail, 8.5, W - 2 * M - 8);
          if (y - (ls.length * 12 + 30) < M) newPage();
          y -= 12;
          txt('承認記録', M, y - 10, 10);
          y -= 16;
          box(M, y - ls.length * 12 - 8, W - 2 * M, ls.length * 12 + 8);
          ls.forEach(function (t, i) { txt(t, M + 4, y - 12 - i * 12, 8.5); });
        }
        return doc.save();
      });
    });
  }

  function saveBytes(bytes, filename) {
    var url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 2000);
  }

  // ───────── 足場：提出状況（現場×日付） ─────────
  var state = { year: null, month: null };
  if (CFG.scaffold) {
    kintone.events.on('app.record.index.show', function (event) {
      var el = document.getElementById('tenken-status');
      if (el) { initState(); renderStatus(el); }
      return event;
    });
    kintone.events.on('mobile.app.record.index.show', function (event) {
      var sp = kintone.mobile.app.getHeaderSpaceElement();
      if (!sp || sp.querySelector('.tk-mobile-status')) return event;
      var wrapEl = document.createElement('div');
      wrapEl.className = 'tk-mobile-status';
      var area = document.createElement('div');
      area.style.display = 'none';
      wrapEl.appendChild(button('提出状況を表示', function (b) {
        var open = area.style.display === 'none';
        area.style.display = open ? '' : 'none';
        b.textContent = open ? '提出状況を閉じる' : '提出状況を表示';
        if (open) { initState(); renderStatus(area); }
      }));
      wrapEl.appendChild(area);
      sp.appendChild(wrapEl);
      return event;
    });
  }
  function initState() {
    var n = new Date();
    state.year = state.year || n.getFullYear();
    state.month = state.month || n.getMonth() + 1;
  }

  var projectCache = null;
  function loadProjects(extras) {
    if (projectCache) return projectCache;
    var today = iso(new Date());
    projectCache = fetchAll(MASTER_APP, '(mkbJsYmd > TODAY() or mkuKsYmd > TODAY())',
      ['KojiNo', 'mkbKojiName', 'mkbJsYmd', 'mkuKsYmd', 'mkbJkYmd', 'mkuKkYmd']).then(function (recs) {
      var map = {};
      recs.forEach(function (r) {
        var no = String(r.KojiNo.value || '').split('.')[0];
        var end = r.mkbJsYmd.value || r.mkuKsYmd.value || '';
        if (no.length !== 8 || (no.slice(2, 5) !== '041' && extras.indexOf(no) < 0) || end <= today) return;
        if (!map[no]) map[no] = { no: no, name: r.mkbKojiName.value || '', start: r.mkbJkYmd.value || r.mkuKkYmd.value || '', end: end };
      });
      return Object.keys(map).sort().map(function (k) { return map[k]; });
    });
    projectCache.catch(function () { projectCache = null; });
    return projectCache;
  }

  function renderStatus(el) {
    el.innerHTML = '<div class="tk-wrap">読み込み中...</div>';
    var y = state.year, m = state.month;
    var ym = y + '-' + pad(m), last = new Date(y, m, 0).getDate();
    fetchAll(JUNPO_CONF, 'kind in ("対象期間", "追加対象")', ['kind', 'koji_no', 'start_date', 'end_date']).then(function (conf) {
      var extras = conf.filter(function (r) { return r.kind.value === '追加対象'; }).map(function (r) { return r.koji_no.value.trim(); });
      return Promise.all([
        loadProjects(extras),
        fetchAll(appId(), 'inspect_date >= "' + ym + '-01" and inspect_date <= "' + ym + '-' + pad(last) + '"',
          ['koji_no', 'koji_name', 'subtype', 'inspect_reason', 'inspect_date']),
        api('/k/v1/records', 'GET', { app: appId(), query: 'order by inspect_date desc limit 500', fields: ['koji_no', 'inspect_date'] }),
        conf
      ]);
    }).then(function (res) {
      var projects = res[0], recs = res[1], lastRecs = res[2].records, conf = res[3];
      var periods = {};
      conf.forEach(function (r) { if (r.kind.value === '対象期間') periods[r.koji_no.value.trim()] = r; });
      var lastBy = {};
      lastRecs.forEach(function (r) { var no = String(r.koji_no.value); if (!lastBy[no]) lastBy[no] = r.inspect_date.value; });
      var byDay = {}, names = {};
      recs.forEach(function (r) {
        var no = String(r.koji_no.value);
        names[no] = names[no] || r.koji_name.value;
        var d = Number(r.inspect_date.value.slice(8, 10));
        ((byDay[no] = byDay[no] || {})[d] = byDay[no][d] || []).push({ id: r.$id.value, label: r.subtype.value + '（' + r.inspect_reason.value + '）' });
      });
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var todayIso = iso(today);
      function row(no, name, start, end, custom) {
        var cells = [], count = 0;
        for (var d = 1; d <= last; d++) {
          var di = ym + '-' + pad(d);
          var recsD = (byDay[no] || {})[d] || [];
          count += recsD.length;
          cells.push({ d: d, recs: recsD, out: !!((start && di < start) || (end && di > end)), today: di === todayIso });
        }
        var lastD = lastBy[no] || '';
        var elapsed = lastD ? Math.round((today - new Date(lastD + 'T00:00:00')) / 86400000) : null;
        return { no: no, name: name, start: start, end: end, custom: custom, cells: cells, count: count, last: lastD, elapsed: elapsed,
                 allOut: cells.every(function (c) { return c.out; }) };
      }
      var rows = projects.map(function (p) {
        var pc = periods[p.no];
        return row(p.no, p.name, pc ? pc.start_date.value || '' : p.start, pc ? pc.end_date.value || '' : p.end, !!pc);
      });
      rows.sort(function (a, b) { return (a.allOut ? 1 : 0) - (b.allOut ? 1 : 0); });
      var listed = {};
      projects.forEach(function (p) { listed[p.no] = 1; });
      var extra = Object.keys(byDay).filter(function (no) { return !listed[no]; }).sort().map(function (no) { return row(no, names[no] || '', '', '', false); });
      var wd = '日月火水木金土';
      var h = ['<div class="tk-wrap"><p class="note">対象現場と対象期間は安全旬報の提出状況と共通です（期間の変更は安全旬報アプリの提出状況から）。記録がある日に緑の印（数字は件数）。灰色は対象期間外。最終点検から7日以上空いている現場は経過日数を赤で表示します。</p>',
        '<div class="nav"><button type="button" class="tk-btn" data-act="prev">← 前月</button><b>' + y + '年' + m + '月</b><button type="button" class="tk-btn" data-act="next">翌月 →</button>',
        '<span class="cnt">今月の対象 ' + rows.filter(function (r) { return !r.allOut; }).length + ' 現場（一覧 ' + rows.length + ' 現場）</span></div>'];
      function table(list, title) {
        if (title) h.push('<h4>' + title + '</h4>');
        h.push('<div class="scroll"><table class="cal"><thead><tr><th>工事№</th><th>工事名・対象期間</th><th>今月<br>件数</th><th>最終点検</th>');
        for (var d = 1; d <= last; d++) {
          var w = new Date(y, m - 1, d).getDay();
          h.push('<th class="day' + (w === 0 ? ' sun' : w === 6 ? ' sat' : '') + '">' + d + '<br>' + wd[w] + '</th>');
        }
        h.push('</tr></thead><tbody>');
        list.forEach(function (r) {
          h.push('<tr class="' + (r.allOut ? 'rowout' : '') + '"><td class="l">' + r.no + '</td><td class="n">' + esc(r.name) +
            ((r.start || r.end) ? '<br><span class="' + (r.custom ? 'per custom' : 'per') + '">' + (r.start || '未定').replace(/-/g, '/') + ' 〜 ' + (r.end || '未定').replace(/-/g, '/') + '</span>' : '') +
            '</td><td>' + r.count + '</td><td class="l">' + (r.last ? r.last.replace(/-/g, '/') : '－') +
            (r.elapsed !== null ? '<br><span class="' + (r.elapsed >= 7 && !r.allOut ? 'warn' : 'per') + '">' + r.elapsed + '日前</span>' : '') + '</td>');
          r.cells.forEach(function (c) {
            h.push('<td class="' + (c.out ? 'out ' : '') + (c.today ? 'today' : '') + '">' + (c.recs.length
              ? '<a class="dot" title="' + esc(c.recs.map(function (x) { return x.label; }).join(' / ')) + '" href="' +
                (isMobile() ? '/k/m/' + appId() + '/show?record=' : '/k/' + appId() + '/show#record=') + c.recs[c.recs.length - 1].id + '">' + c.recs.length + '</a>' : '') + '</td>');
          });
          h.push('</tr>');
        });
        if (!list.length) h.push('<tr><td colspan="' + (4 + last) + '">対象現場がありません。</td></tr>');
        h.push('</tbody></table></div>');
      }
      table(rows);
      if (extra.length) table(extra, '対象リスト外の工事№で記録されたもの');
      h.push('</div>');
      el.innerHTML = h.join('');
      el.onclick = function (e) {
        var b = e.target.closest('button[data-act]');
        if (!b) return;
        var d = new Date(state.year, state.month - 1 + (b.getAttribute('data-act') === 'next' ? 1 : -1), 1);
        state.year = d.getFullYear();
        state.month = d.getMonth() + 1;
        renderStatus(el);
      };
    }).catch(function (e) {
      console.error(e);
      el.innerHTML = '<div class="tk-wrap">提出状況の読み込みに失敗しました：' + esc((e && e.message) || e) + '</div>';
    });
  }

  window.__tenken = { buildPdf: buildPdf, renderStatus: renderStatus, state: state };   // 動作確認用

  var css = [
    '.tk-btn{margin:4px 6px 4px 0;padding:6px 14px;border:1px solid #3498db;background:#fff;color:#3498db;border-radius:16px;cursor:pointer;font-size:13px}',
    '.tk-btn:hover{background:#eaf4fb}.tk-btn:disabled{opacity:.6;cursor:default}',
    '.tk-modal{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px}',
    '.tk-box{background:#fff;border-radius:10px;max-width:760px;width:100%;max-height:88vh;display:flex;flex-direction:column}',
    '.tk-head{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:1px solid #e3e7e8}',
    '.tk-body{overflow:auto;padding:12px 16px;font-size:13px;line-height:1.7}',
    '.tk-guide{border-bottom:1px solid #eef0f1;padding:10px 0}.tk-gt{font-weight:700;margin-bottom:4px}',
    '.tk-gi img{max-width:220px;max-height:180px;margin:6px 8px 0 0;border-radius:6px;cursor:zoom-in;border:1px solid #e3e7e8}',
    '.tk-wrap{padding:12px 16px;font-size:13px;color:#333}.tk-wrap .note{color:#666;line-height:1.6;margin:0 0 8px}',
    '.tk-wrap .nav{display:flex;align-items:center;gap:8px;margin:8px 0 12px;flex-wrap:wrap}.tk-wrap .nav b{font-size:17px}.tk-wrap .cnt{margin-left:auto;color:#666}',
    '.tk-wrap .scroll{overflow-x:auto}',
    '.cal{border-collapse:collapse;font-size:12px;background:#fff}',
    '.cal th,.cal td{border:1px solid #e3e7e8;padding:4px 3px;text-align:center}',
    '.cal th{background:#f5f7f8;font-weight:500}.cal th.day{min-width:24px}.cal th.sat{color:#1f6fb2}.cal th.sun{color:#b3382c}',
    '.cal td.l{text-align:left;white-space:nowrap;padding:4px 8px}.cal td.n{text-align:left;min-width:200px;padding:4px 8px}',
    '.cal td.out{background:#f3f4f6}.cal td.today{outline:2px solid #1f6fb2;outline-offset:-2px}',
    '.cal a.dot{display:inline-block;min-width:18px;height:18px;line-height:18px;border-radius:9px;background:#1f7a3a;color:#fff;font-weight:700;text-decoration:none;font-size:11px}',
    '.cal tr.rowout td{color:#8a949a}.cal .per{font-size:11px;color:#5b656b}.cal .custom{color:#1f6fb2;font-weight:700}.cal .warn{color:#b3382c;font-weight:700}',
    '.tk-mobile-status{padding:8px}'
  ].join('\n');
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
})();
