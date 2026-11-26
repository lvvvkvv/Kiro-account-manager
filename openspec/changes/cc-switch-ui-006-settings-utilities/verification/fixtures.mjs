// 整个验证不连接真实系统、模型、通知或文件服务；只运行真实 renderer 接线。
export function utilitiesFixture() {
  const base = window.api;
  window.__http = [];
  window.__httpStatus = 200;
  window.fetch = async (url, opts) => {
    window.__http.push({
      url: String(url),
      body: JSON.parse(opts.body),
      method: opts.method,
      headers: opts.headers,
    });
    return new Response("{}", {
      status: window.__httpStatus,
      headers: { "Content-Type": "application/json" },
    });
  };
  window.__alerts = [];
  window.__confirmations = [];
  window.__confirm = true;
  window.__prompt = "fixture-password";
  window.__clipboard = "";
  window.__downloads = [];
  window.alert = (t) => window.__alerts.push(t);
  window.confirm = (t) => {
    window.__confirmations.push(t);
    return window.__confirm;
  };
  window.prompt = () => window.__prompt;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (t) => (window.__clipboard = t) },
  });
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => {
    const u = create(b);
    b.text().then((text) => window.__downloads.push({ type: b.type, text }));
    return u;
  };
  window.__machine = "11111111-1111-4111-8111-111111111111";
  window.__admin = true;
  window.__machineFail = false;
  window.__kiro = {
    settings: {
      agentAutonomy: "Supervised",
      modelSelection: "fixture-model",
      trustedCommands: ["git status"],
      commandDenylist: ["rm -rf /"],
      trustedTools: { fixture: true },
    },
    mcpConfig: {
      mcpServers: {
        fixture: {
          command: "node",
          args: ["server.js"],
          env: { FIXTURE: "yes" },
        },
      },
    },
    steeringFiles: ["fixture.md"],
  };
  window.__steering = "# Fixture\nOriginal rule";
  window.__import = null;
  window.__update = {
    hasUpdate: false,
    currentVersion: "1.7.6",
    error: "Fixture update failed",
  };
  window.__logs = Array.from({ length: 100 }, (_, i) => ({
    timestamp: new Date(Date.now() - (100 - i) * 1000).toISOString(),
    level: ["DEBUG", "INFO", "WARN", "ERROR"][i % 4],
    category: i % 2 ? "Kiro" : "ProxyServer",
    message: `Fixture log ${i}`,
    data: i === 99 ? { fixture: "detail" } : undefined,
  }));
  window.__holdLiveness = false;
  window.__pending = [];
  window.__data.proxyUrl = "http://127.0.0.1:7890";
  window.__data.autoRefreshEnabled = false;
  window.__data.autoSwitchEnabled = false;
  window.__data.batchImportConcurrency = 5;
  window.__data.originalMachineId = "00000000-0000-4000-8000-000000000000";
  window.__data.originalBackupTime = Date.now();
  window.__data.machineIdHistory = [];
  window.__data.accountMachineIds = {};
  window.__data.machineIdConfig = {
    autoSwitchOnAccountChange: false,
    bindMachineIdToAccount: true,
    useBindedMachineId: true,
  };
  for (const a of Object.values(window.__data.accounts)) {
    a.credentials.accessToken = "fixture-access";
    a.credentials.refreshToken = "fixture-refresh";
  }
  const extra = {
    getUsageApiType: () => "rest",
    getUseKProxyForApi: () => false,
    getTraySettings: () => ({
      enabled: true,
      closeAction: "ask",
      showNotifications: true,
      minimizeOnStart: false,
    }),
    machineIdGetOSType: () => "macos",
    machineIdCheckAdmin: () => window.__admin,
    machineIdGetCurrent: () => ({ success: true, machineId: window.__machine }),
    machineIdGenerateRandom: () => "22222222-2222-4222-8222-222222222222",
    machineIdSet: (id) => {
      if (window.__machineFail) return { success: false, requiresAdmin: true };
      window.__machine = id;
      return { success: true };
    },
    machineIdRestoreFromFile: () => ({
      success: true,
      machineId: "33333333-3333-4333-8333-333333333333",
    }),
    machineIdBackupToFile: () => ({ success: true }),
    machineIdRequestAdminRestart: () => ({ success: true }),
    getKiroSettings: () => structuredClone(window.__kiro),
    getKiroAvailableModels: () => ({
      models: [
        {
          id: "fixture-model",
          name: "Fixture Model",
          description: "Memory fixture",
        },
      ],
    }),
    proxyGetModels: () => ({
      success: true,
      models: [{ id: "fixture-model" }],
    }),
    saveKiroSettings: (s) => {
      window.__kiro.settings = structuredClone(s);
      return { success: true };
    },
    saveMcpServer: (name, server, old) => {
      if (old) delete window.__kiro.mcpConfig.mcpServers[old];
      window.__kiro.mcpConfig.mcpServers[name] = structuredClone(server);
      return { success: true };
    },
    deleteMcpServer: (n) => {
      delete window.__kiro.mcpConfig.mcpServers[n];
      return { success: true };
    },
    readKiroSteeringFile: () => ({ success: true, content: window.__steering }),
    saveKiroSteeringFile: (n, c) => {
      window.__steering = c;
      return { success: true };
    },
    deleteKiroSteeringFile: (n) => {
      window.__kiro.steeringFiles = window.__kiro.steeringFiles.filter(
        (x) => x !== n,
      );
      return { success: true };
    },
    createKiroDefaultRules: () => {
      window.__kiro.steeringFiles = ["fixture.md", "default.md"];
      return { success: true };
    },
    diagnoseRun: ({ targets }) => ({
      results: targets.map((t, i) => ({
        id: t.id,
        success: i !== 1,
        httpStatus: i === 1 ? 503 : 200,
        latencyMs: 17,
        error: i === 1 ? "Fixture unavailable" : undefined,
      })),
    }),
    diagnoseAccountLiveness: async (p) => {
      if (window.__holdLiveness)
        await new Promise((r) => window.__pending.push(r));
      return {
        success: p.account.id !== "fixture-1",
        latencyMs: 20,
        content: "pong",
        error:
          p.account.id === "fixture-1" ? "Fixture unauthorized" : undefined,
      };
    },
    proxyGetLogs: () => structuredClone(window.__logs),
    proxyGetLogsCount: () => window.__logs.length,
    proxyClearLogs: () => {
      window.__logs = [];
      return { success: true };
    },
    checkForUpdatesManual: () => structuredClone(window.__update),
    importFromFile: () => window.__import,
    setShowWindowShortcut: () => ({ success: true }),
    setUsageApiType: () => ({ success: true }),
    setUseKProxyForApi: () => ({ success: true }),
    saveTraySettings: () => ({ success: true }),
    setProactiveRenewalEnabled: (enabled) => ({ success: true, enabled }),
  };
  window.api = new Proxy(base, {
    get(target, name) {
      if (extra[name])
        return async (...args) => {
          window.__calls.push({ name, args });
          return extra[name](...args);
        };
      return target[name];
    },
  });
}
