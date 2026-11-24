(function () {
  "use strict";

  try {
    var script = document.currentScript;
    if (!script) return;

    var projectKey =
      script.getAttribute("data-project") ||
      script.getAttribute("data-api-key") ||
      "";

    var endpoint =
      script.getAttribute("data-endpoint") ||
      script.src.replace(/\/tracker\.js.*$/, "/api/v1/analytics");

    if (!projectKey) return;

    var lastPath = "";

    function sendHit() {
      var currentPath = window.location.pathname || "/";
      if (currentPath === lastPath) return;
      lastPath = currentPath;

      var referrer = document.referrer ? new URL(document.referrer).hostname : "direct";
      var screenWidth = window.innerWidth || document.documentElement.clientWidth;
      var device = screenWidth < 768 ? "mobile" : screenWidth < 1024 ? "tablet" : "desktop";

      var payload = JSON.stringify({
        project: projectKey,
        path: currentPath,
        referrer: referrer,
        device: device,
        language: navigator.language || "",
      });

      if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, payload);
      } else {
        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(function () {});
      }
    }

    // Trigger on initial page load
    if (document.readyState === "complete") {
      sendHit();
    } else {
      window.addEventListener("load", sendHit);
    }

    // Single Page App (SPA) navigation listeners
    var originalPush = history.pushState;
    if (originalPush) {
      history.pushState = function () {
        originalPush.apply(this, arguments);
        setTimeout(sendHit, 50);
      };
      window.addEventListener("popstate", sendHit);
    }
  } catch (e) {
    // Fail silently without disrupting parent application
  }
})();
