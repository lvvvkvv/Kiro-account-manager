// 只使用 example.invalid 和虚构密钥；内存 IPC，不启动监听或执行证书/客户端磁盘写入。
export function proxyFixture() {
  const original = window.api;
  window.__alerts = [];
  window.__confirms = [];
  window.__confirmResult = true;
  window.__clipboard = "";
  window.alert = (v) => window.__alerts.push(String(v));
  window.confirm = (v) => {
    window.__confirms.push(String(v));
    return window.__confirmResult;
  };
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (v) => {
        window.__clipboard = v;
      },
      readText: async () => window.__clipboard,
    },
  });
  const now = Date.now();
  const usage = {
    totalRequests: 7,
    totalCredits: 1.2345,
    totalInputTokens: 1234,
    totalOutputTokens: 567,
    daily: {
      "2026-11-25": {
        requests: 7,
        credits: 1.2345,
        inputTokens: 1234,
        outputTokens: 567,
      },
    },
    byModel: {
      "claude-fixture": {
        requests: 7,
        credits: 1.2345,
        inputTokens: 1234,
        outputTokens: 567,
      },
    },
  };
  window.__proxy = {
    running: false,
    config: {
      enabled: false,
      port: 5580,
      host: "127.0.0.1",
      apiKey: "sk-fixture",
      enableMultiAccount: true,
      logRequests: true,
      autoStart: false,
      clientDrivenToolExecution: true,
      modelMappings: [],
    },
    stats: {
      totalRequests: 7,
      successRequests: 6,
      failedRequests: 1,
      totalTokens: 1801,
      totalCredits: 1.2345,
      inputTokens: 1234,
      outputTokens: 567,
      cacheReadTokens: 120,
      cacheWriteTokens: 30,
      reasoningTokens: 50,
      startTime: now,
    },
    sessionStats: {
      totalRequests: 3,
      successRequests: 2,
      failedRequests: 1,
      startTime: now,
    },
    keys: [
      {
        id: "key-0",
        name: "Fixture key",
        key: "sk-fixture-secret",
        format: "sk",
        enabled: true,
        createdAt: now,
        creditsLimit: 12,
        usage,
        usageHistory: [
          {
            timestamp: now,
            model: "claude-fixture",
            inputTokens: 1234,
            outputTokens: 567,
            credits: 1.2345,
            path: "/v1/messages",
          },
        ],
      },
    ],
    needsRestart: true,
    models: [
      {
        id: "claude-fixture",
        name: "Fixture Model",
        description: "Test model with a long description",
        inputTypes: ["TEXT", "IMAGE"],
        maxInputTokens: 200000,
        maxOutputTokens: 8192,
        supportsThinking: true,
        supportsPromptCaching: true,
        rateMultiplier: 1,
      },
    ],
    logs: [
      {
        time: "2026-11-26 12:00:00.000",
        path: "/v1/messages",
        status: 500,
        error: "Fixture request error",
        tokens: 1801,
        inputTokens: 1234,
        outputTokens: 567,
        credits: 1.2345,
      },
    ],
    detailed: [
      {
        timestamp: new Date(now).toISOString(),
        level: "ERROR",
        category: "fixture",
        message: "Fixture detailed error",
        data: { detail: "Fixture data" },
      },
      {
        timestamp: new Date(now).toISOString(),
        level: "INFO",
        category: "request",
        message: "Fixture success",
      },
    ],
    accounts: [],
  };
  window.__kproxy = {
    running: false,
    installed: false,
    config: {
      enabled: false,
      host: "127.0.0.1",
      port: 8899,
      mitmDomains: ["amazonaws.com"],
      autoStart: false,
      logRequests: true,
      deviceId: "a".repeat(64),
    },
    stats: {
      totalRequests: 10,
      mitmRequests: 7,
      bypassRequests: 3,
      modifiedRequests: 6,
      startTime: now,
      lastRequestTime: now,
    },
  };
  window.__fail = {};
  Object.values(window.__data.accounts).forEach((a, i) => {
    a.credentials.accessToken = `fixture-access-${i}`;
    a.credentials.refreshToken = `fixture-refresh-${i}`;
    a.credentials.region = "us-east-1";
    a.groupId = i === 0 ? "group-0" : undefined;
  });
  window.__data.groups = {
    "group-0": {
      id: "group-0",
      name: "Fixture Group",
      color: "#0891b2",
      order: 0,
    },
  };
  window.api = new Proxy(
    {},
    {
      get: (_, name) => {
        if (!/^(proxy|kproxy|accountGetModels)/.test(String(name)))
          return original[name];
        return async (...args) => {
          window.__calls.push({ name, args });
          if (window.__fail[name])
            return { success: false, error: window.__fail[name], models: [] };
          const p = window.__proxy,
            k = window.__kproxy;
          const cert = {
            success: true,
            cert: "-----BEGIN CERTIFICATE-----\nFIXTURE\n-----END CERTIFICATE-----",
            fingerprint: "00:11:22:33",
            subject: "CN=fixture.invalid",
            notBefore: now,
            notAfter: now + 86400000,
            altNames: ["localhost"],
          };
          switch (name) {
            case "proxyGetStatus":
              return structuredClone(p);
            case "proxyUpdateConfig":
              Object.assign(p.config, args[0]);
              return { success: true };
            case "proxyStart":
              p.running = true;
              Object.assign(p.config, args[0] || {});
              window.__emit("onProxyStatusChange", {
                running: true,
                port: p.config.port,
              });
              return { success: true };
            case "proxyStop":
              p.running = false;
              window.__emit("onProxyStatusChange", {
                running: false,
                port: p.config.port,
              });
              return { success: true };
            case "proxyRestart":
              p.needsRestart = false;
              return { success: true };
            case "proxyNeedsRestart":
              return { needsRestart: p.needsRestart };
            case "proxyGetAccounts":
              return {
                accounts: p.accounts,
                availableCount: p.accounts.length,
              };
            case "proxySyncAccounts":
              p.accounts = structuredClone(args[0]);
              return { success: true, accountCount: p.accounts.length };
            case "proxyGetModels":
            case "accountGetModels":
              return { success: true, models: p.models, fromCache: true };
            case "proxyRefreshModels":
              return { success: true };
            case "proxyLoadLogs":
              return { success: true, logs: p.logs };
            case "proxySaveLogs":
              p.logs = args[0];
              return { success: true };
            case "proxyGetLogs":
              return p.detailed;
            case "proxyClearLogs":
              p.detailed = [];
              return { success: true };
            case "proxyResetCredits":
              p.stats.totalCredits = 0;
              return { success: true };
            case "proxyResetTokens":
              p.stats.inputTokens = 0;
              p.stats.outputTokens = 0;
              return { success: true };
            case "proxyResetRequestStats":
              p.stats.totalRequests = 0;
              p.sessionStats.totalRequests = 0;
              return { success: true };
            case "proxyGetApiKeys":
              return { success: true, apiKeys: structuredClone(p.keys) };
            case "proxyAddApiKey": {
              const key = {
                id: `key-${p.keys.length}`,
                key: `${args[0].format}-fixture-generated`,
                enabled: true,
                createdAt: now,
                usage: { ...usage },
                ...args[0],
              };
              p.keys.push(key);
              return { success: true, apiKey: structuredClone(key) };
            }
            case "proxyUpdateApiKey":
              Object.assign(
                p.keys.find((x) => x.id === args[0]),
                args[1],
              );
              return { success: true };
            case "proxyDeleteApiKey":
              p.keys = p.keys.filter((x) => x.id !== args[0]);
              return { success: true };
            case "proxyResetApiKeyUsage":
              return { success: true };
            case "proxySelfSignedCertInfo":
            case "proxySelfSignedCertRegenerate":
              return cert;
            case "proxyAuditLog":
              return {
                entries: [{ ts: now, type: "config", data: { port: 5580 } }],
              };
            case "proxyConfigureClients":
              return {
                success: true,
                proxyOrigin: "http://localhost:5580",
                openaiBaseUrl: "http://localhost:5580/v1",
                results: args[0].clients.map((client) => ({
                  client,
                  success: true,
                  paths: [`/fixture/${client}.json`],
                  backupPaths: [`/fixture/${client}.backup`],
                })),
              };
            case "proxyPoolValidate":
              return { success: true, latencyMs: 123, externalIp: "192.0.2.1" };
            case "proxyPoolDiagnoseChain":
              return {
                success: true,
                diagnose: {
                  upstreamReachable: true,
                  targetReachable: true,
                  endToEndOk: true,
                  targetStatus: 200,
                },
              };
            case "kproxyInit":
              return {
                success: true,
                caInfo: {
                  certPath: "/fixture/ca.crt",
                  fingerprint: "00:11:22",
                  validFrom: new Date(now).toISOString(),
                  validTo: new Date(now + 86400000).toISOString(),
                },
              };
            case "kproxyGetStatus":
              return structuredClone(k);
            case "kproxyUpdateConfig":
              Object.assign(k.config, args[0]);
              return { success: true };
            case "kproxyStart":
              k.running = true;
              Object.assign(k.config, args[0]);
              return { success: true };
            case "kproxyStop":
              k.running = false;
              return { success: true };
            case "kproxyCheckCaCertInstalled":
              return { installed: k.installed };
            case "kproxyInstallCaCert":
              k.installed = true;
              return { success: true };
            case "kproxyUninstallCaCert":
              k.installed = false;
              return { success: true };
            case "kproxyExportCaCert":
              return { success: true };
            case "kproxyGenerateDeviceId":
              return { success: true, deviceId: "b".repeat(64) };
            case "kproxySetDeviceId":
              return { success: true };
            default:
              return { success: false, error: "Unmocked fixture API" };
          }
        };
      },
    },
  );
}
