/**
 * Auto-reconnect poller for the 502/503/504 page.
 *
 * Lives in its own file rather than inline in 502.html so that `script-src 'self'` covers it. The
 * alternative — pinning a second sha256 in the CSP — would apply that hash to every page on the
 * site and add another hash to keep in sync whenever this file changes, which is exactly the
 * maintenance trap the index.html theme script already documents. (audit NGINX-ERRORPAGE-HEADERS-1)
 *
 * Served by nginx off disk, so it still loads while the backend is down.
 */
(function () {
  var el = document.getElementById('status');
  var attempt = 0;

  function check() {
    attempt++;
    el.textContent = 'Reconnecting... (attempt ' + attempt + ')';
    fetch(window.location.href, { cache: 'no-store' })
      .then(function (r) {
        if (
          r.ok &&
          r.headers.get('content-type') &&
          r.headers.get('content-type').indexOf('text/html') !== -1
        ) {
          return r.text().then(function (body) {
            // Only reload if the response is the real app, not this error page
            if (body.indexOf('game-container') !== -1) {
              window.location.reload();
            } else {
              setTimeout(check, 2000);
            }
          });
        }
        setTimeout(check, 2000);
      })
      .catch(function () {
        setTimeout(check, 2000);
      });
  }

  setTimeout(check, 2000);
})();
