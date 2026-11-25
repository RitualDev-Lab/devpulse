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

    var originBase = script.src.replace(/\/tracker\.js.*$/, "");
    var analyticsEndpoint = script.getAttribute("data-endpoint") || originBase + "/api/v1/analytics";
    var crashEndpoint = originBase + "/api/v1/event";

    if (!projectKey) return;

    var lastPath = "";

    function detectDevice() {
      var w = window.innerWidth || document.documentElement.clientWidth || 1200;
      return w < 768 ? "mobile" : w < 1024 ? "tablet" : "desktop";
    }

    function dispatchAnalytics(eventName, customPath) {
      var currentPath = customPath || window.location.pathname || "/";
      var referrer = "direct";
      try {
        referrer = document.referrer ? new URL(document.referrer).hostname : "direct";
      } catch (e) {}

      var payload = JSON.stringify({
        project: projectKey,
        path: currentPath,
        referrer: referrer,
        device: detectDevice(),
        sourceType: "web",
        eventName: eventName || "pageview",
        appVersion: appVersion,
      });

      if (navigator.sendBeacon) {
        navigator.sendBeacon(analyticsEndpoint, new Blob([payload], { type: "application/json" }));
      } else {
        fetch(analyticsEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(function () {});
      }
    }

    function sendHit() {
      var currentPath = window.location.pathname || "/";
      if (currentPath === lastPath) return;
      lastPath = currentPath;
      dispatchAnalytics("pageview", currentPath);
    }

    // Expose programmatic Web/App tracker: window.devpulse.track("signup_clicked")
    window.devpulse = window.devpulse || {};
    window.devpulse.track = function (eventName, pathOverride) {
      dispatchAnalytics(eventName || "custom_event", pathOverride || window.location.pathname || "/");
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

    // Optional Sentry-style automatic browser crash capture (enable via data-crashes="true" data-api-key="dp_live_...")
    if (captureCrashes) {
      window.addEventListener("error", function (event) {
        fetch(crashEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: crashKey,
            errorName: (event.error && event.error.name) || "UncaughtError",
            message: event.message || "Unhandled browser exception",
            stackTrace: (event.error && event.error.stack) || (event.filename + ":" + event.lineno),
            runtime: "browser",
            version: appVersion,
            os: navigator.platform || "Browser",
            environment: "production",
          }),
          keepalive: true,
        }).catch(function () {});
      });

      window.addEventListener("unhandledrejection", function (event) {
        var reason = event.reason;
        fetch(crashEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: crashKey,
            errorName: (reason && reason.name) || "UnhandledPromiseRejection",
            message: (reason && reason.message) || String(reason || "Promise rejected"),
            stackTrace: (reason && reason.stack) || null,
            runtime: "browser",
            version: appVersion,
            os: navigator.platform || "Browser",
            environment: "production",
          }),
          keepalive: true,
        }).catch(function () {});
      });
    }
  } catch (e) {}
})();
