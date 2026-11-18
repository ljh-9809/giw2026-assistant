(function(){
  if (window.__giwCap) return 'already';
  window.__giwCap = { buf: [], sent: 0, room: location.hostname.replace(/^kr\.giw-/, '').replace(/\.mangople\.com$/, '') };
  var seen = {};
  function stamp(){
    var d = new Date(new Date().toLocaleString('en-US', { timeZone:'Asia/Seoul' }));
    return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }
  function grab(){
    var nodes = document.querySelectorAll('p, div');
    nodes.forEach(function(n){
      if (n.children.length) return;
      var s = (n.innerText || '').trim();
      if (s.length < 12 || s.length > 600) return;
      if (/Tap to keep screen|Settings|Share|QR code|Original Text|폰트|전체화면|Translated text is fully available|Voice translation is only available|earphones or Bluetooth|choose a language that also offers audio/i.test(s)) return;
      var ko = /[가-힣]/.test(s);
      var key = (ko ? 'k' : 'e') + '|' + s;
      if (seen[key]) return;
      seen[key] = 1;
      var b = window.__giwCap.buf, last = b.length ? b[b.length-1] : null;
      var kk = ko ? 'ko' : 'en';
      if (last && last.k === kk && s.indexOf(last.s) === 0) { b[b.length-1] = { t: last.t, s: s, k: kk }; return; }
      if (last && last.k === kk && last.s.indexOf(s) === 0) return;
      b.push({ t: stamp(), s: s, k: kk });
    });
  }
  new MutationObserver(grab).observe(document.body, { childList:true, subtree:true, characterData:true });
  setInterval(grab, 1500);
  setInterval(function(){
    var c = window.__giwCap;
    if (!c.buf.length) return;
    var batch = c.buf.splice(0, 200);
    var d = new Date(new Date().toLocaleString('en-US', { timeZone:'Asia/Seoul' }));
    var date = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    fetch('https://giw2026-assistant.vercel.app/api/caption', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ room: c.room, date: date, lines: batch })
    }).then(function(r){ return r.json(); }).then(function(j){ c.sent += (j.added || 0); })
      .catch(function(){ c.buf = batch.concat(c.buf); });
  }, 20000);
  return 'started:' + window.__giwCap.room;
})()