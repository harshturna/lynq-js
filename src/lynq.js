(function () {
  "use strict";
  const CONFIG = {
    ENDPOINT: "http://localhost:3000/api/lynq",
    SESSION_DURATION: 10 * 60 * 1000,
    STORAGE_KEYS: {
      SESSION_ID: "au_si",
      EXPIRATION: "au_se",
      CLIENT_ID: "au_ci",
    },
    EVENTS: {
      PAGE_VIEW: "page-view",
      SESSION_START: "session-start",
      SESSION_END: "session-end",
      ERROR: "error",
      PERFORMANCE: "performance",
      CORE_VITAL: "vital",
      WEB_VITALS: "web-vitals",
      CUSTOM_EVENT: "custom-event",
      INITIAL_CUSTOM_EVENT: "initial-custom-event",
    },
    PERFORMANCE: {
      MAX_LCP_TIME: 5000, // Maximum time to wait for LCP
      METRIC_TYPES: {
        NAVIGATION: "navigation",
        PAINT: "paint",
        LARGEST_CONTENTFUL_PAINT: "largest-contentful-paint",
        LAYOUT_SHIFT: "layout-shift",
        FIRST_INPUT: "first-input",
        RESOURCE: "resource",
        LONG_TASK: "longtask",
      },
    },
  };

  class BrowserDetector {
    detect(userAgent) {
      const browser = this.detectBrowser(userAgent);
      const os = this.detectOS(userAgent);

      return {
        ...browser,
        os,
      };
    }

    detectBrowser(userAgent) {
      const browserPatterns = [
        {
          pattern: /Edg\/([0-9.]+)/i,
          name: "Edge",
        },
        {
          pattern: /OPR\/([0-9.]+)/i,
          name: "Opera",
        },
        {
          pattern: /Chrome\/([0-9.]+)/i,
          name: "Chrome",
        },
        {
          pattern: /Firefox\/([0-9.]+)/i,
          name: "Firefox",
        },
        {
          pattern: /Safari\/([0-9.]+)/i,
          name: "Safari",
        },
      ];

      for (const browser of browserPatterns) {
        const match = userAgent.match(browser.pattern);

        if (match) {
          return browser.name;
        }
      }

      return "Unknown";
    }

    detectOS(userAgent) {
      const osPatterns = {
        windows: {
          pattern: /Windows NT ([0-9.]+)/i,
          versions: {
            "10.0": "10",
            6.3: "8.1",
            6.2: "8",
            6.1: "7",
            "6.0": "Vista",
            5.2: "XP 64-bit",
            5.1: "XP",
          },
        },
        mac: {
          pattern: /Mac OS X ([0-9._]+)/i,
          clean: (version) => version.replace(/_/g, "."),
        },
        ios: {
          pattern: /OS ([0-9._]+) like Mac OS X/i,
          clean: (version) => version.replace(/_/g, "."),
        },
        android: {
          pattern: /Android ([0-9.]+)/i,
        },
        linux: {
          pattern: /Linux/i,
        },
      };

      for (const [osName, data] of Object.entries(osPatterns)) {
        const match = userAgent.match(data.pattern);
        if (match) {
          return osName.charAt(0).toUpperCase() + osName.slice(1);
        }
      }

      return "Unknown";
    }
  }

  class PerformanceTracker {
    constructor(analyticsTracker) {
      this.analyticsTracker = analyticsTracker;
      this.observers = new Map();
      this.metrics = {
        // Core Web Vitals
        lcp: 0, // Largest Contentful Paint
        cls: 0, // Cumulative Layout Shift
        inp: 0, // Interaction to Next Paint

        // Additional Metrics
        fcp: 0, // First Contentful Paint
        ttfb: 0, // Time to First Byte
        tbt: 0, // Total Blocking Time

        // Page Load Metrics
        dcl: 0, // DOM Content Loaded
        load: 0, // Load Event
        tti: 0, // Time to Interactive

        // Resource Data
        resources: [],

        // Additional Data
        interactionCount: 0,
        totalJSHeapSize: 0,
        usedJSHeapSize: 0,
      };

      this.interactionTimes = [];
      this.finalMetricsSent = false;

      if (this.isPerformanceSupported()) {
        this.initializeTracking();
      }
    }

    isPerformanceSupported() {
      return (
        typeof window !== "undefined" &&
        window.performance &&
        window.PerformanceObserver
      );
    }

    initializeTracking() {
      try {
        this.setupPerformanceObservers();
        this.setupNavigationTracking();
        this.setupResourceTracking();
        this.setupVisibilityTracking();
      } catch (error) {
        console.error("Failed to initialize performance tracking:", error);
      }
    }

    setupPerformanceObservers() {
      this.createObserver("paint", this.observePaint.bind(this));
      this.createObserver("lcp", this.observeLCP.bind(this));
      this.createObserver("cls", this.observeCLS.bind(this));
      this.createObserver("inp", this.observeINP.bind(this));
      this.createObserver("longtasks", this.observeLongTasks.bind(this));
    }

    createObserver(name, observerFn) {
      try {
        const observer = observerFn();
        if (observer) {
          this.observers.set(name, observer);
        }
      } catch (error) {
        console.error(`Failed to create ${name} observer:`, error);
      }
    }

    observePaint() {
      return new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        entries.forEach((entry) => {
          if (entry.name === "first-contentful-paint") {
            this.metrics.fcp = entry.startTime;
          }
        });
      }).observe({ type: "paint", buffered: true });
    }

    observeLCP() {
      const observer = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        entries.forEach((entry) => {
          if (entry.startTime > this.metrics.lcp) {
            this.metrics.lcp = entry.startTime;
          }
        });
      });
      observer.observe({ type: "largest-contentful-paint", buffered: true });
      return observer;
    }

    observeCLS() {
      let sessionEntries = [];
      return new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        entries.forEach((entry) => {
          if (!entry.hadRecentInput) {
            sessionEntries = this.updateCLS(sessionEntries, entry);
          }
        });
      }).observe({ type: "layout-shift", buffered: true });
    }

    updateCLS(sessionEntries, entry) {
      const updatedEntries = [...sessionEntries, entry];
      this.metrics.cls = this.calculateMaxSessionGap(updatedEntries);
      return updatedEntries;
    }

    calculateMaxSessionGap(entries) {
      let maxSessionValue = 0;
      let session = [];
      let sessionStart = 0;

      entries.forEach((entry) => {
        if (!session.length || entry.startTime - sessionStart < 1000) {
          session.push(entry);
        } else {
          maxSessionValue = Math.max(
            maxSessionValue,
            session.reduce((sum, e) => sum + e.value, 0)
          );
          session = [entry];
          sessionStart = entry.startTime;
        }
      });

      return Math.max(
        maxSessionValue,
        session.reduce((sum, e) => sum + e.value, 0)
      );
    }

    observeINP() {
      return new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        this.metrics.interactionCount += entries.length;

        entries.forEach((entry) => {
          this.interactionTimes.push(entry.duration);
        });

        if (this.interactionTimes.length > 0) {
          const sortedTimes = [...this.interactionTimes].sort((a, b) => a - b);
          const idx = Math.floor(sortedTimes.length * 0.75);
          this.metrics.inp = sortedTimes[idx];
        }
      }).observe({
        type: "event",
        buffered: true,
        durationThreshold: 16,
      });
    }

    observeLongTasks() {
      let totalBlockingTime = 0;
      return new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        entries.forEach((entry) => {
          const blockingTime = entry.duration - 50;
          if (blockingTime > 0) {
            totalBlockingTime += blockingTime;
            this.metrics.tbt = totalBlockingTime;
          }
        });
      }).observe({ type: "longtask", buffered: true });
    }

    setupNavigationTracking() {
      if (document.readyState === "complete") {
        this.collectNavigationMetrics();
      } else {
        document.addEventListener("readystatechange", () => {
          if (document.readyState === "complete") {
            this.collectNavigationMetrics();
          }
        });
      }
    }

    collectNavigationMetrics() {
      const navEntry = performance.getEntriesByType("navigation")[0];
      if (navEntry) {
        this.metrics.dcl = navEntry.domContentLoadedEventStart;
        this.metrics.load = navEntry.loadEventStart;
        this.metrics.ttfb = navEntry.responseStart;
        this.metrics.tti = navEntry.domInteractive;
      }
    }

    setupResourceTracking() {
      this.resourceObserver = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        entries.forEach((entry) => {
          if (entry.transferSize > 0 && entry.duration > 100) {
            this.metrics.resources.push({
              name: entry.name,
              type: entry.initiatorType,
              duration: entry.duration,
              transferSize: entry.transferSize,
              startTime: entry.startTime,
              protocol: entry.nextHopProtocol || "",
            });
          }
        });
      });
      this.resourceObserver.observe({ type: "resource", buffered: true });
    }

    setupVisibilityTracking() {
      window.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          this.sendFinalMetrics();
        }
      });

      window.addEventListener("beforeunload", () => {
        this.sendFinalMetrics();
      });
    }

    collectPerformanceMetrics() {
      // Collect memory usage if available
      if (performance.memory) {
        this.metrics.totalJSHeapSize = performance.memory.totalJSHeapSize;
        this.metrics.usedJSHeapSize = performance.memory.usedJSHeapSize;
      }

      // Add resource timing data
      this.metrics.resourceCount =
        performance.getEntriesByType("resource").length;
    }

    sendFinalMetrics() {
      if (!this.finalMetricsSent) {
        this.finalMetricsSent = true;
        this.collectPerformanceMetrics();

        this.analyticsTracker.trackEvent(
          "web-vitals",
          {
            ...this.metrics,
          },
          { keepalive: true }
        );
      }
    }

    destroy() {
      this.observers.forEach((observer) => observer.disconnect());
      this.observers.clear();

      if (this.resourceObserver) {
        this.resourceObserver.disconnect();
      }

      this.sendFinalMetrics();
    }
  }

  class AnalyticsTracker {
    constructor() {
      this.scriptElement = document.currentScript;
      this.dataDomain = this.scriptElement?.getAttribute("data-domain");
      this.clientId = this.getOrCreateClientId();
      this.initialPathname = window.location.pathname;
      this.session = null;
      this.mutationObserver = null;
      this.isDestroyed = false;

      // Initialize in correct order
      this.initializeSession();
      this.performanceTracker = new PerformanceTracker(this);
      this.setupEventListeners();
    }
    getOrCreateClientId() {
      try {
        let clientId = localStorage.getItem(CONFIG.STORAGE_KEYS.CLIENT_ID);
        if (!clientId) {
          clientId = `${crypto.randomUUID()}`;
          localStorage.setItem(CONFIG.STORAGE_KEYS.CLIENT_ID, clientId);
        }
        return clientId;
      } catch (error) {
        console.error("Failed to manage client ID:", error);
        return `${Math.random().toString(36).substring(2, 9)}`;
      }
    }

    generateSessionId() {
      try {
        return `${crypto.randomUUID()}`;
      } catch {
        return `${Math.random().toString(36).substring(2, 9)}`;
      }
    }

    isSessionExpired(expirationTime) {
      return Date.now() >= parseInt(expirationTime);
    }

    initializeSession() {
      try {
        const sessionId = localStorage.getItem(CONFIG.STORAGE_KEYS.SESSION_ID);
        const expirationTime = localStorage.getItem(
          CONFIG.STORAGE_KEYS.EXPIRATION
        );

        if (
          !sessionId ||
          !expirationTime ||
          this.isSessionExpired(expirationTime)
        ) {
          const newSessionId = this.generateSessionId();
          const newExpirationTime = Date.now() + CONFIG.SESSION_DURATION;

          localStorage.setItem(CONFIG.STORAGE_KEYS.SESSION_ID, newSessionId);
          localStorage.setItem(
            CONFIG.STORAGE_KEYS.EXPIRATION,
            newExpirationTime
          );

          this.session = {
            sessionId: newSessionId,
            expirationTime: newExpirationTime,
            startTime: Date.now(),
          };
          this.trackEvent(CONFIG.EVENTS.SESSION_START);
          this.initializeLynq("initial-custom-event");
        } else {
          this.session = {
            sessionId,
            expirationTime: parseInt(expirationTime),
            startTime: Date.now(),
          };
          // tracking page view if it's not a new session, for new session the session-start event captures page view
          this.trackPageView();
          this.initializeLynq("custom-event");
        }

        // Set up session refresh interval
        this.sessionInterval = setInterval(
          () => this.refreshSession(),
          CONFIG.SESSION_DURATION / 2
        );
      } catch {}
    }

    initializeLynq(eventType) {
      // flush queued events
      const queuedEvents = window.lynqQueue || [];
      if (queuedEvents.length > 0) {
        queuedEvents.forEach((data) => {
          this.trackEvent(eventType, data);
        });
      }
      delete window.lynqQueue;

      // initialize lynq
      window.lynq = {
        track: (name, properties) =>
          this.trackEvent(CONFIG.EVENTS.CUSTOM_EVENT, {
            name,
            eventId: crypto.randomUUID(),
            properties,
          }),
      };
    }

    refreshSession() {
      if (document.visibilityState === "visible" && !this.isDestroyed) {
        const newExpirationTime = Date.now() + CONFIG.SESSION_DURATION;
        try {
          localStorage.setItem(
            CONFIG.STORAGE_KEYS.EXPIRATION,
            newExpirationTime
          );
          this.session.expirationTime = newExpirationTime;
        } catch {}
      }
    }

    async trackEvent(eventName, eventData = {}, options = {}) {
      if (this.isDestroyed) return;

      // Safety check for session
      if (!this.session?.sessionId) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (!this.session?.sessionId) return;
      }

      // device information from user agent client-side
      const detector = new BrowserDetector();
      const userAgentData = {
        browser: detector.detectBrowser(navigator.userAgent),
        os: detector.detectOS(navigator.userAgent),
      };

      const referrer = document.referrer.startsWith(window.location.origin)
        ? "Direct"
        : document.referrer;

      const payload = {
        event: eventName,
        timestamp: Date.now(),
        url: window.location.href,
        pathname: window.location.pathname,
        referrer: referrer || "Direct",
        // TODO: Temp - delete after testing
        dataDomain: this.dataDomain || "clair.byharsh.com",
        clientId: this.clientId,
        sessionId: this.session.sessionId,
        pageLoadId: this.pageLoadId,
        userAgentData,
        eventData,
      };

      return this.sendAnalyticsRequest(payload, options);
    }

    sendAnalyticsRequest(payload) {
      const blob = new Blob([JSON.stringify(payload)], {
        type: "application/json",
      });

      return navigator.sendBeacon(CONFIG.ENDPOINT, blob);
    }

    trackPageView() {
      if (this.isDestroyed) return;
      this.trackEvent(CONFIG.EVENTS.PAGE_VIEW);
      this.initialPathname = window.location.pathname;
    }

    setupEventListeners() {
      // Generate unique ID for this page load
      this.pageLoadId = crypto.randomUUID();

      // Handle navigation events
      window.addEventListener("hashchange", this.trackPageView);

      // Handle client-side navigation
      this.mutationObserver = new MutationObserver(() => {
        if (
          !this.isDestroyed &&
          window.location.pathname !== this.initialPathname
        ) {
          this.trackPageView();
        }
      });

      this.mutationObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });

      // page close handler
      window.addEventListener("beforeunload", () => {
        this.trackEvent(
          CONFIG.EVENTS.SESSION_END,
          {
            sessionDuration: Date.now() - this.session.startTime,
            currentUrl: window.location.href,
          },
          { keepalive: true }
        );
      });
    }

    destroy() {
      this.isDestroyed = true;

      // Clear intervals
      if (this.sessionInterval) {
        clearInterval(this.sessionInterval);
      }

      // Remove event listeners
      window.removeEventListener("hashchange", this.trackPageView);

      // Disconnect observers
      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
      }

      // Clean up performance tracker if it has a destroy method
      if (this.performanceTracker?.destroy) {
        this.performanceTracker.destroy();
      }
    }
  }

  // Initialize the tracker
  const tracker = new AnalyticsTracker();

  window.your_tracking = (...args) => tracker.trackEvent(...args);
})();
