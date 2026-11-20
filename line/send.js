/* KohKey Line — 録音した声の送り先。
   送り先を変えるときは、このファイルだけを書き換える。

   約束ごと：
     window.kohkeySend(blob, info) を呼ぶと Promise が返る。
     成功なら { ok: true, preview: 真偽 }、失敗なら例外を投げる。
     blob … 録音した音声（Chrome 系は webm、Safari は mp4）
     info … { seconds, mimeType, language, recordedAt }
   名前や連絡先など、声のほかに本人を特定するものは送らない。 */
(function () {
  'use strict';

  function fileName(info) {
    var ext = /mp4|aac|m4a/.test(info.mimeType) ? 'm4a'
            : /ogg/.test(info.mimeType) ? 'ogg' : 'webm';
    return 'kohkey-' + info.recordedAt.replace(/[:.]/g, '-') + '.' + ext;
  }

  window.kohkeySend = function (blob, info) {
    var endpoint = (window.KOHKEY && window.KOHKEY.sendEndpoint) || '';

    // 送り先が未定のあいだ：どこにも送らず、送ったふりだけする。
    if (!endpoint) {
      return new Promise(function (resolve) {
        setTimeout(function () { resolve({ ok: true, preview: true }); }, 900);
      });
    }

    // 送り先が決まったあと：音声を文字（base64）にして、最小限の情報と一緒に POST する。
    // 送り先は Google Apps Script（~/kohkey-line/drive-receiver/Code.gs）。
    // Content-Type を付けない（text/plain になる）のは、Apps Script が事前確認の通信に答えないため。
    return toBase64(blob).then(function (audio) {
      return fetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          audio: audio,
          fileName: fileName(info),
          mimeType: info.mimeType.split(';')[0],
          seconds: info.seconds,
          language: info.language,
          recordedAt: info.recordedAt
        })
      });
    }).then(function (res) {
      if (!res.ok) throw new Error('send failed: ' + res.status);
      return res.json();
    }).then(function (result) {
      if (!result || !result.ok) throw new Error('rejected: ' + (result && result.reason));
      return { ok: true, preview: false };
    });
  };

  function toBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).split(',')[1] || ''); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
})();
