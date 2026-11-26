// 仅使用 example.invalid 样例；IPC 均在浏览器内存中处理。
export function installFixture({ platform = "darwin" } = {}) {
  window.__listeners = {};
  window.__subscriptions = {};
  window.__calls = [];
  window.__emit = (name, ...args) =>
    [...(window.__listeners[name] || [])].forEach((fn) => fn(...args));
  const subscribe = (name, fn) => {
    (window.__listeners[name] ||= []).push(fn);
    window.__subscriptions[name] = (window.__subscriptions[name] || 0) + 1;
    return () => {
      window.__listeners[name] = window.__listeners[name].filter(
        (item) => item !== fn,
      );
    };
  };
  const accounts = Object.fromEntries(
    ["active", "error", "expired"].map((status, i) => {
      const id = `fixture-${i}`;
      return [
        id,
        {
          id,
          email: `fixture${i}@example.invalid`,
          nickname: `Fixture ${i}`,
          userId: `fixture-user-${i}`,
          idp: "BuilderId",
          machineId: "0".repeat(64),
          credentials: {
            accessToken: "",
            csrfToken: "",
            expiresAt: Date.now() + 86400000,
          },
          subscription: {
            type: "Pro",
            title: "KIRO PRO",
            daysRemaining: i ? 2 : 30,
          },
          usage: {
            current: i ? 96 : 22,
            limit: 100,
            percentUsed: i ? 0.96 : 0.22,
            lastUpdated: Date.now(),
          },
          tags: [],
          status,
          isActive: i === 0,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          lastError: status === "error" ? "Account suspended" : undefined,
        },
      ];
    }),
  );
  window.__fixtureAccounts = structuredClone(accounts);
  window.__data = {
    accounts,
    groups: {},
    tags: {},
    activeAccountId: "fixture-0",
    theme: "light",
    language: "en",
    darkMode: false,
    privacyMode: false,
    usagePrecision: true,
    autoRefreshEnabled: false,
  };
  window.__platform = platform;
  let maximized = false;
  const windowApi = {
    getPlatform: async () => window.__platform,
    isMaximized: async () => maximized,
    onMaximizeChange: (fn) => subscribe("onMaximizeChange", fn),
    minimize: () => {
      window.__calls.push({ name: "window.minimize", args: [] });
    },
    maximizeToggle: () => {
      window.__calls.push({ name: "window.maximizeToggle", args: [] });
      maximized = !maximized;
      window.__emit("onMaximizeChange", maximized);
    },
    close: () => {
      window.__calls.push({ name: "window.close", args: [] });
    },
  };
  window.api = new Proxy(
    {},
    {
      get: (_, name) => {
        if (name === "window") return windowApi;
        if (String(name).startsWith("on")) return (fn) => subscribe(name, fn);
        return async (...args) => {
          window.__calls.push({ name, args });
          if (name === "getAppVersion") return "1.7.6";
          if (name === "loadAccounts") {
            if (window.__loadError) throw new Error("Fixture load failed");
            if (window.__deferLoad)
              return new Promise((resolve) => {
                window.__resolveLoad = () =>
                  resolve(structuredClone(window.__data));
              });
            return structuredClone(window.__data);
          }
          if (name === "saveAccounts") {
            window.__data = structuredClone(args[0]);
            return { success: true };
          }
          if (name === "getTraySettings") return {};
          if (name === "getShowWindowShortcut")
            return "CommandOrControl+Shift+K";
          if (name === "getUsageApiType") return "desktop";
          if (name === "getProactiveRenewalEnabled") return false;
          if (name === "proxyGetLogs") return [];
          if (name === "proxyGetLogsCount") return 0;
          if (name === "proxyGetAccounts")
            return { accounts: [], availableCount: 0 };
          return { success: false, error: "Fixture unavailable" };
        };
      },
    },
  );
}
