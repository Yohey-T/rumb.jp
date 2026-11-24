/* KohKey Line — 画面の動き。
   流れ： かける → すぐ track-web（途中でも 1・2 可）→ menu → 6秒待つ → goodbye → 終話
          （曲の頭が「Welcome to the program」なので welcome は流さない。電話と同じ）
          2 を押す → 注意書き（before-record）→ 録音 → 聴き直し → 送る → thanks → goodbye → 終話
   文言や番号は config.js、送り先は send.js にある。 */
(function () {
  'use strict';

  var C = window.KOHKEY;
  var root = document.documentElement;
  var $ = function (id) { return document.getElementById(id); };

  var player = $('player');
  var el = {
    status: $('status'), caption: $('caption'), progress: $('progress'), dot: $('dot'),
    key1: $('key-1'), key2: $('key-2'),
    agree: $('agree'), record: $('btn-record'), noticeMsg: $('notice-msg'),
    play: $('btn-play'), send: $('btn-send'), discard: $('btn-discard'), reviewMsg: $('review-msg'),
    endnote: $('endnote')
  };

  var IDLE_LINE = 'A phone line for the morning you take a step.';
  var PANEL = {
    idle: 'idle', ringing: 'call', call: 'call', closing: 'call',
    notice: 'notice', recording: 'recording', review: 'review', sending: 'review', ended: 'ended'
  };

  var state = 'idle';
  var seq = 0;              // 再生の順番を取り消すための番号
  var pendingDone = null;   // いま再生中の音を終わらせる関数
  var progressOn = false;

  // ---------- 表示 ----------

  function setState(next) {
    state = next;
    root.setAttribute('data-state', next);
    var panels = document.querySelectorAll('[data-panel]');
    for (var i = 0; i < panels.length; i++) {
      panels[i].hidden = panels[i].getAttribute('data-panel') !== PANEL[next];
    }
    var keysOn = next === 'call';
    el.key1.disabled = !keysOn;
    el.key2.disabled = !keysOn;
    var busy = next === 'sending';
    el.play.disabled = busy; el.send.disabled = busy; el.discard.disabled = busy;
    el.send.textContent = busy ? 'Sending…' : 'Send';
  }

  function setCaption(text) { el.caption.textContent = text || ''; }
  function setStatus(text) { el.status.textContent = text; }
  function setProgress(ratio) {
    el.progress.style.transform = 'scaleX(' + Math.max(0, Math.min(1, ratio || 0)) + ')';
  }
  function showMsg(node, text) { node.textContent = text || ''; node.hidden = !text; }

  function clock(totalSeconds) {
    var s = Math.max(0, Math.floor(totalSeconds));
    var m = Math.floor(s / 60); s = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ---------- 通話時間 ----------

  var callStart = 0, callTimer = null;

  function callSeconds() { return (Date.now() - callStart) / 1000; }
  function showCallTime() {
    if (state !== 'recording') setStatus('Connected · ' + clock(callSeconds()));
  }
  function startCallTimer() {
    callStart = Date.now();
    showCallTime();
    callTimer = setInterval(showCallTime, 500);
  }
  function stopCallTimer() { clearInterval(callTimer); callTimer = null; }

  // ---------- 音の再生 ----------

  var found = {}; // 名前 → 見つかった URL（無ければ null）

  function findAudio(name) {
    if (name in found) return Promise.resolve(found[name]);
    var list = C.audioExts.map(function (ext) { return C.audioDir + name + '.' + ext; });
    if (location.protocol === 'file:') { // ファイルを直接開いたときは確かめられない
      found[name] = list[list.length - 1];
      return Promise.resolve(found[name]);
    }
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.resolve(null);
      var url = list[i++];
      return fetch(url, { method: 'HEAD' }).then(function (res) {
        return res.ok ? url : next();
      }, next);
    }
    return next().then(function (url) { found[name] = url; return url; });
  }

  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  function stopPlayer() {
    player.pause();
    if (pendingDone) pendingDone();
  }

  function playUrl(url) {
    return new Promise(function (resolve) {
      function done() {
        player.removeEventListener('ended', done);
        player.removeEventListener('error', done);
        if (pendingDone === done) pendingDone = null;
        resolve();
      }
      pendingDone = done;
      player.addEventListener('ended', done);
      player.addEventListener('error', done);
      player.src = url;
      var p = player.play();
      if (p && p.catch) p.catch(done);
    });
  }

  function playOne(name, mine) {
    return findAudio(name).then(function (url) {
      if (mine !== seq) return;
      setCaption(C.captions[name]);
      progressOn = name === 'track-web';
      setProgress(0);
      return url ? playUrl(url) : wait(700); // 音が無ければ短い間だけあける
    });
  }

  // 名前の順に流し、最後まで流れたら after を呼ぶ。途中で別の操作があれば止まる。
  function run(names, after) {
    var mine = ++seq;
    stopPlayer();
    var chain = Promise.resolve();
    names.forEach(function (name) {
      chain = chain.then(function () { if (mine === seq) return playOne(name, mine); });
    });
    chain.then(function () {
      if (mine !== seq) return;
      progressOn = false;
      if (after) after();
    });
  }

  function hush() { seq++; stopPlayer(); progressOn = false; }

  player.addEventListener('timeupdate', function () {
    if (progressOn && isFinite(player.duration) && player.duration > 0) {
      setProgress(player.currentTime / player.duration);
    }
  });

  // スマートフォンは、指で押した瞬間に一度鳴らした再生器でないと後から音を出せない。
  // 「かける」を押した瞬間に、無音をごく短く鳴らしておく。
  var silence = (function () {
    var n = 400, bytes = new Uint8Array(44 + n), view = new DataView(bytes.buffer), i;
    function put(at, text) { for (var k = 0; k < text.length; k++) bytes[at + k] = text.charCodeAt(k); }
    put(0, 'RIFF'); view.setUint32(4, 36 + n, true); put(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true); view.setUint32(28, 8000, true);
    view.setUint16(32, 1, true); view.setUint16(34, 8, true);
    put(36, 'data'); view.setUint32(40, n, true);
    for (i = 44; i < 44 + n; i++) bytes[i] = 128;
    var text = '';
    for (i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    return 'data:audio/wav;base64,' + btoa(text);
  })();

  // ---------- 通話 ----------

  function call() {
    if (state !== 'idle' && state !== 'ended') return;
    var mine = ++seq;
    player.src = silence;
    var p = player.play();
    if (p && p.catch) p.catch(function () {});
    sent = null;
    setState('ringing');
    setStatus('Calling…');
    setCaption('');
    setProgress(0);
    setTimeout(function () {
      if (mine !== seq) return;
      startCallTimer();
      setState('call');
      run(['track-web'], menuThenClose);
    }, 1400);
  }

  // 曲のあと：案内を流し、何も押されないまま6秒たったら終わりの案内へ（電話の Gather timeout と同じ）
  function menuThenClose() {
    setState('call');
    run(['menu'], function () {
      var mine = seq;
      setTimeout(function () { if (mine === seq && state === 'call') closing(); }, 6000);
    });
  }

  function closing() {
    setState('closing');
    run(['goodbye'], end);
  }

  function end() {
    hush();
    dropRecording();
    var length = callTimer ? clock(callSeconds()) : '00:00';
    stopCallTimer();
    setState('ended');
    setStatus('Call ended · ' + length);
    setCaption('');
    setProgress(0);
    var note = sent === 'preview' ? 'Preview only. Nothing was sent.'
             : sent === 'real' ? 'Your message was received.' : '';
    showMsg(el.endnote, note);
  }

  function backToMenu() { menuThenClose(); }

  function pressKey(n) {
    if (state !== 'call') return;
    var key = n === 1 ? el.key1 : el.key2;
    key.setAttribute('aria-pressed', 'true');
    setTimeout(function () { key.removeAttribute('aria-pressed'); }, 180);
    if (n === 1) {
      run(['track-web'], menuThenClose);
    } else {
      el.agree.checked = false;
      el.record.disabled = true;
      showMsg(el.noticeMsg, '');
      setState('notice');
      run(['before-record']);
    }
  }

  // ---------- 録音 ----------

  var stream = null, recorder = null, chunks = [], recStart = 0, recTimer = null;
  var keepTake = false;       // 止めたあと、聴き直しに進むかどうか
  var take = null;            // { blob, url, seconds, mimeType, recordedAt }
  var sent = null;            // 'preview' か 'real'
  var meter = null;

  function pickMime() {
    var types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < types.length; i++) {
      if (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return '';
  }

  function startRecording() {
    if (state !== 'notice' || !el.agree.checked) return;
    hush();
    showMsg(el.noticeMsg, '');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      showMsg(el.noticeMsg, 'This browser can’t record here. You can still call the number from a phone.');
      return;
    }
    el.record.disabled = true;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
      if (state !== 'notice') { stopTracks(s); return; }
      stream = s;
      var mime = pickMime();
      recorder = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
      chunks = [];
      keepTake = true;
      recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = onRecorderStop;
      recorder.start();
      recStart = Date.now();
      setState('recording');
      setCaption('A few words for someone taking a step tomorrow.');
      tickRecording();
      recTimer = setInterval(tickRecording, 100);
      startMeter(s);
    }).catch(function (err) {
      el.record.disabled = !el.agree.checked;
      var name = err && err.name;
      var text = name === 'NotFoundError' || name === 'OverconstrainedError'
        ? 'No microphone was found on this device.'
        : name === 'NotReadableError'
        ? 'Another app is using the microphone. Close it, then try again.'
        : 'The microphone is blocked here. If you opened this page inside another app, open it in Chrome or Safari instead. Otherwise, allow the microphone in your browser’s site settings, then try again.';
      showMsg(el.noticeMsg, text);
    });
  }

  function tickRecording() {
    var elapsed = (Date.now() - recStart) / 1000;
    var left = Math.max(0, C.maxSeconds - elapsed);
    setStatus('Recording · ' + clock(Math.ceil(left)).slice(1) + ' left');
    setProgress(elapsed / C.maxSeconds);
    if (left <= 0) stopRecording();
  }

  function stopRecording() {
    clearInterval(recTimer); recTimer = null;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    else releaseMic();
  }

  function onRecorderStop() {
    var seconds = Math.min(C.maxSeconds, (Date.now() - recStart) / 1000);
    var mimeType = (recorder && recorder.mimeType) || 'audio/webm';
    var blob = new Blob(chunks, { type: mimeType });
    releaseMic();
    if (!keepTake) return;
    showCallTime();
    setProgress(0);
    if (!blob.size || seconds < 0.5) {
      setState('notice');
      el.record.disabled = !el.agree.checked;
      showMsg(el.noticeMsg, 'Nothing was recorded. Try again.');
      return;
    }
    take = {
      blob: blob, url: URL.createObjectURL(blob), seconds: Math.round(seconds),
      mimeType: mimeType, recordedAt: new Date().toISOString()
    };
    showMsg(el.reviewMsg, '');
    el.play.textContent = 'Play it back';
    setState('review');
    setCaption('Your message, ' + take.seconds + ' seconds. Listen back, then send it or let it go.');
  }

  function stopTracks(s) { s.getTracks().forEach(function (t) { t.stop(); }); }

  function releaseMic() {
    stopMeter();
    if (stream) { stopTracks(stream); stream = null; }
    recorder = null;
    chunks = [];
  }

  function dropRecording() {
    keepTake = false;
    stopRecording();
    if (take) { URL.revokeObjectURL(take.url); take = null; }
  }

  // 録音中、声の大きさで印を少し動かす（マイクが生きていることの合図）
  function startMeter(s) {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      var ctx = new Ctx();
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(analyser);
      var data = new Uint8Array(analyser.fftSize);
      meter = { ctx: ctx, raf: 0 };
      (function loop() {
        if (!meter) return;
        analyser.getByteTimeDomainData(data);
        var sum = 0;
        for (var i = 0; i < data.length; i++) { var v = (data[i] - 128) / 128; sum += v * v; }
        el.dot.style.setProperty('--level', Math.min(0.6, Math.sqrt(sum / data.length) * 4).toFixed(2));
        meter.raf = requestAnimationFrame(loop);
      })();
    } catch (e) { meter = null; }
  }

  function stopMeter() {
    if (!meter) return;
    cancelAnimationFrame(meter.raf);
    try { meter.ctx.close(); } catch (e) {}
    meter = null;
    el.dot.style.removeProperty('--level');
  }

  // ---------- 聴き直しと送信 ----------

  function togglePlayback() {
    if (state !== 'review' || !take) return;
    if (el.play.textContent === 'Stop') { hush(); el.play.textContent = 'Play it back'; return; }
    var mine = ++seq;
    stopPlayer();
    el.play.textContent = 'Stop';
    playUrl(take.url).then(function () {
      if (mine === seq) el.play.textContent = 'Play it back';
    });
  }

  function send() {
    if (state !== 'review' || !take) return;
    hush();
    el.play.textContent = 'Play it back';
    showMsg(el.reviewMsg, '');
    setState('sending');
    var info = {
      seconds: take.seconds, mimeType: take.mimeType,
      language: navigator.language || '', recordedAt: take.recordedAt
    };
    window.kohkeySend(take.blob, info).then(function (result) {
      if (state !== 'sending') return;
      sent = result && result.preview ? 'preview' : 'real';
      URL.revokeObjectURL(take.url); take = null;
      setState('closing');
      run(['thanks', 'goodbye'], end);
    }).catch(function () {
      if (state !== 'sending') return;
      setState('review');
      showMsg(el.reviewMsg, 'It didn’t go through. Your recording is still here. Try again.');
    });
  }

  function discard() {
    if (state !== 'review') return;
    hush();
    dropRecording();
    backToMenu();
  }

  // ---------- つなぐ ----------

  $('number').textContent = C.phoneDisplay;
  if (C.phoneDial) {
    $('dial-link').href = 'tel:' + C.phoneDial;
    $('dial-link').textContent = C.phoneDisplay;
    $('dial-row').hidden = false;
  }
  if (C.aboutUrl) { $('about-link').href = C.aboutUrl; $('about-row').hidden = false; }
  if (!C.sendEndpoint) $('preview-tag').hidden = false;

  $('btn-call').addEventListener('click', call);
  $('btn-again').addEventListener('click', call);
  $('btn-end').addEventListener('click', end);
  el.key1.addEventListener('click', function () { pressKey(1); });
  el.key2.addEventListener('click', function () { pressKey(2); });
  el.agree.addEventListener('change', function () { el.record.disabled = !el.agree.checked; });
  el.record.addEventListener('click', startRecording);
  $('btn-back').addEventListener('click', function () { if (state === 'notice') { hush(); backToMenu(); } });
  $('btn-stop').addEventListener('click', stopRecording);
  el.play.addEventListener('click', togglePlayback);
  el.send.addEventListener('click', send);
  el.discard.addEventListener('click', discard);

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '1') pressKey(1);
    if (e.key === '2') pressKey(2);
  });

  setState('idle');
  setCaption(IDLE_LINE);
  Object.keys(C.captions).forEach(findAudio); // 先に音のありかを調べておく
})();
