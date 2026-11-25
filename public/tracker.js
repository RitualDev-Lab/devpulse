(function () {
  "use strict";

  try {
    var script = document.currentScript;
    if (!script) return;

    var projectKey =
      script.getAttribute("data-project") ||
      script.getAttribute("data-api-key") ||
      "";
    var crashKey = script.getAttribute("data-api-key") || "";
    var captureCrashes = script.getAttribute("data-crashes") === "true" && !!crashKey;
    var appVersion = script.getAttribute("data-version") || null;

    var originBase = script.src.replace(/\/(tracker\.js|pulse\/s\.js).*$/, "");
    var analyticsEndpoint = script.getAttribute("data-endpoint") || originBase + "/api/v1/analytics";
    var crashEndpoint = originBase + "/api/v1/event";

    if (!projectKey) return;

    var lastPath = "";
    var pendingQueue = [];
    var MAX_BEACON_BYTES = 57344; // 56 KiB safety margin under WHATWG 64 KiB aggregate budget
    var textEncoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

    function byteLength(str) {
      return textEncoder ? textEncoder.encode(str).length : str.length;
    }

    function detectDevice() {
      var w = window.innerWidth || document.documentElement.clientWidth || 1200;
      return w < 768 ? "mobile" : w < 1024 ? "tablet" : "desktop";
    }

    function sendPayload(endpoint, jsonStr, allowBeacon) {
      var bytes = byteLength(jsonStr);
      if (allowBeacon && navigator.sendBeacon && bytes <= MAX_BEACON_BYTES) {
        try {
          // text/plain avoids CORS preflight while Next route parses JSON string body
          var ok = navigator.sendBeacon(endpoint, new Blob([jsonStr], { type: "text/plain;charset=UTF-8" }));
          if (ok) return;
        } catch (e) {}
      }

      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: jsonStr,
        keepalive: bytes <= MAX_BEACON_BYTES,
      }).catch(function () {});
    }

    function dispatchAnalytics(eventName, customPath, allowBeacon) {
      var currentPath = customPath || window.location.pathname || "/";
      var referrer = "direct";
      try {
        referrer = document.referrer ? new URL(document.referrer).hostname : "direct";
      } catch (e) {}

      var jsonStr = JSON.stringify({
        project: projectKey,
        path: currentPath,
        referrer: referrer,
        device: detectDevice(),
        sourceType: "web",
        eventName: eventName || "pageview",
        appVersion: appVersion,
      });

      if (document.visibilityState === "hidden" || allowBeacon) {
        sendPayload(analyticsEndpoint, jsonStr, true);
      } else {
        sendPayload(analyticsEndpoint, jsonStr, false);
      }
    }

    function sendHit() {
      var currentPath = window.location.pathname || "/";
      if (currentPath === lastPath) return;
      lastPath = currentPath;
      dispatchAnalytics("pageview", currentPath, false);
    }

    function flushOnHide() {
      while (pendingQueue.length > 0) {
        var item = pendingQueue.shift();
        if (item) sendPayload(item.url, item.body, true);
      }
    }

    // Reliable mobile & desktop unload hooks
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flushOnHide();
    });
    window.addEventListener("pagehide", flushOnHide);

    // Expose programmatic Web/App tracker: window.devpulse.track("signup_clicked")
    window.devpulse = window.devpulse || {};
    window.devpulse.track = function (eventName, pathOverride) {
      dispatchAnalytics(eventName || "custom_event", pathOverride || window.location.pathname || "/", false);
    };

    if (document.readyState === "complete") {
      sendHit();
    } else {
      window.addEventListener("load", sendHit);
    }

    // SPA navigation support
    var originalPush = history.pushState;
    if (originalPush) {
      history.pushState = function () {
        originalPush.apply(this, arguments);
        sendHit();
      };
      window.addEventListener("popstate", sendHit);
    }

    // Optional Sentry-style automatic browser crash capture
    if (captureCrashes) {
      window.addEventListener("error", function (event) {
        var errBody = JSON.stringify({
          apiKey: crashKey,
          errorName: String((event.error && event.error.name) || "UncaughtError").slice(0, 120),
          message: String(event.message || "Unhandled browser exception").slice(0, 1024),
          stackTrace: String((event.error && event.error.stack) || (event.filename + ":" + event.lineno)).slice(0, 16384),
          runtime: "browser",
          version: appVersion,
          os: navigator.platform || "Browser",
          environment: "production",
        });
        sendPayload(crashEndpoint, errBody, true);
      });

      window.addEventListener("unhandledrejection", function (event) {
        var reason = event.reason;
        var rejBody = JSON.stringify({
          apiKey: crashKey,
          errorName: String((reason && reason.name) || "UnhandledPromiseRejection").slice(0, 120),
          message: String((reason && reason.message) || reason || "Promise rejected").slice(0, 1024),
          stackTrace: reason && reason.stack ? String(reason.stack).slice(0, 16384) : null,
          runtime: "browser",
          version: appVersion,
          os: navigator.platform || "Browser",
          environment: "production",
        });
        sendPayload(crashEndpoint, rejBody, true);
      });
    }
  } catch (e) {}
})();
