(function () {
  'use strict';
  var BASE = 'https://typhoon-inspection-app.vercel.app';
  var CATMAP = {
    '安全旬報': 'safety_patrol',
    '台風養生点検': 'typhoon',
    '災害時現場点検': 'disaster',
    '足場点検記録': 'scaffold'
  };

  function userQuery() {
    var u = kintone.getLoginUser();
    return 'kintone_user=' + encodeURIComponent(u.name) + '&kintone_code=' + encodeURIComponent(u.code);
  }

  // 一覧（点検アプリビュー）：iframeにアプリを読み込む。
  // 通知経由でレコード詳細から転送されてきた場合は該当報告書を直接表示する。
  kintone.events.on('app.record.index.show', function (event) {
    var frame = document.getElementById('tenken-frame');
    if (frame && !frame.getAttribute('src')) {
      var target = null;
      try {
        target = sessionStorage.getItem('tenkenTarget');
        sessionStorage.removeItem('tenkenTarget');
      } catch (e) {}
      var path = target || '/';
      var sep = path.indexOf('?') === -1 ? '?' : '&';
      // 中身の高さに追従させる（内側スクロールをなくし、kintoneページ側だけでスクロール）
      frame.setAttribute('scrolling', 'no');
      frame.style.overflow = 'hidden';
      frame.style.height = '800px';
      frame.src = BASE + path + sep + userQuery();
    }
    return event;
  });

  function getFrame() { return document.getElementById('tenken-frame'); }

  // スマホ（kintoneモバイル）：カスタマイズビューは表示されないので、
  // 一覧のヘッダースペースにiframeを差し込み、標準のレコード一覧は隠す。
  kintone.events.on('mobile.app.record.index.show', function (event) {
    var existing = document.getElementById('tenken-frame');
    if (existing) {
      // カスタマイズビューがスマホでも描画された場合：srcだけ設定する
      if (!existing.getAttribute('src')) {
        var t0 = null;
        try { t0 = sessionStorage.getItem('tenkenTarget'); sessionStorage.removeItem('tenkenTarget'); } catch (e) {}
        var p0 = t0 || '/';
        existing.setAttribute('scrolling', 'no');
        existing.style.cssText = 'width:100%;border:none;display:block;overflow:hidden;height:800px;';
        existing.src = BASE + p0 + (p0.indexOf('?') === -1 ? '?' : '&') + userQuery();
      }
      return event;
    }
    var sp = kintone.mobile.app.getHeaderSpaceElement();
    if (!sp) return event;
    var target = null;
    try {
      target = sessionStorage.getItem('tenkenTarget');
      sessionStorage.removeItem('tenkenTarget');
    } catch (e) {}
    var path = target || '/';
    var sep = path.indexOf('?') === -1 ? '?' : '&';
    // 標準のレコード一覧はDOM構造が変わりうるので隠さず、
    // ヘッダー直下から画面下端までを覆う固定表示のiframeで見えなくする（iframe内でスクロール）。
    var frame = document.createElement('iframe');
    frame.id = 'tenken-frame';
    frame.setAttribute('data-mobile', '1');
    var top = Math.max(0, Math.round(sp.getBoundingClientRect().top + window.scrollY));
    frame.style.cssText = 'position:fixed;left:0;right:0;bottom:0;top:' + top + 'px;width:100%;border:none;background:#fff;z-index:900;';
    frame.src = BASE + path + sep + userQuery();
    document.body.appendChild(frame);
    document.body.style.overflow = 'hidden';
    return event;
  });

  function isMobile() { return location.pathname.indexOf('/k/m/') === 0; }
  function indexUrl() { return (isMobile() ? '/k/m/' : '/k/') + kintone.app.getId() + '/'; }

  // アプリから見えている範囲を知らせる（モーダルの表示位置合わせ用）
  function sendViewport() {
    var f = getFrame();
    if (!f || !f.contentWindow) return;
    var r = f.getBoundingClientRect();
    f.contentWindow.postMessage({
      type: 'tenken-viewport',
      top: Math.max(0, -r.top),
      height: window.innerHeight
    }, BASE);
  }
  window.addEventListener('scroll', sendViewport, { passive: true });
  window.addEventListener('resize', sendViewport);

  window.addEventListener('message', function (e) {
    if (e.origin !== BASE || !e.data) return;
    var f = getFrame();
    if (!f) return;
    if (e.data.type === 'tenken-height') {
      if (f.getAttribute('data-mobile') !== '1') { f.style.height = Math.max(400, e.data.height) + 'px'; }
      sendViewport();
    } else if (e.data.type === 'tenken-whoami') {
      // アプリ側でログイン情報が落ちたときに問い合わせが来るので返す
      var u = kintone.getLoginUser();
      f.contentWindow.postMessage({ type: 'tenken-user', name: u.name, code: u.code }, BASE);
    } else if (e.data.type === 'tenken-loaded') {
      // 画面遷移のたびにiframeの先頭が見えるようスクロール位置を戻す
      var r = f.getBoundingClientRect();
      if (f.getAttribute('data-mobile') !== '1' && r.top < 0) { window.scrollTo({ top: window.scrollY + r.top - 8 }); }
      sendViewport();
    }
  });

  // レコード詳細（通知クリックの着地点）：点検アプリの該当画面へ転送する。
  // 開発者はデータ確認のため転送せず、ボタンだけ表示。
  kintone.events.on(['app.record.detail.show', 'mobile.app.record.detail.show'], function (event) {
    var rec = event.record;
    var catLabel = rec.category && rec.category.value ? rec.category.value : '安全旬報';
    var catKey = CATMAP[catLabel] || 'safety_patrol';
    var rid = rec.report_id && rec.report_id.value ? parseInt(rec.report_id.value, 10) : null;
    if (!rid) return event;
    var path = '/reports/' + catKey + '/' + rid;

    var u = kintone.getLoginUser();
    if (u.code === 'c0114101') {
      var sp = isMobile() ? kintone.mobile.app.record.getHeaderSpaceElement() : kintone.app.record.getHeaderMenuSpaceElement();
      if (sp && !sp.querySelector('.tenken-open-btn')) {
        var b = document.createElement('button');
        b.textContent = '点検アプリで開く';
        b.className = 'tenken-open-btn';
        b.style.cssText = 'padding:8px 16px;margin:4px;background:#b3382c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px;';
        b.onclick = function () {
          try { sessionStorage.setItem('tenkenTarget', path); } catch (e) {}
          location.href = indexUrl();
        };
        sp.appendChild(b);
      }
    } else {
      try { sessionStorage.setItem('tenkenTarget', path); } catch (e) {}
      location.href = indexUrl();
    }
    return event;
  });
})();
