// 所有身份、订阅 URL、代理和响应仅存在于内存；不连接任何注册/计费服务。
export function registrationFixture() {
  const base = window.api;
  window.__alerts = [];
  window.__confirmations = [];
  window.__confirm = true;
  window.__prompt = "Fixture template";
  window.__clipboard = "";
  window.__downloads = [];
  window.alert = (text) => window.__alerts.push(text);
  window.confirm = (text) => {
    window.__confirmations.push(text);
    return window.__confirm;
  };
  window.prompt = () => window.__prompt;
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: async (text) => {
        window.__clipboard = text;
      },
    },
    configurable: true,
  });
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    const url = create(blob);
    blob
      .text()
      .then((text) => window.__downloads.push({ type: blob.type, text }));
    return url;
  };
  const template = window.__fixtureAccounts["fixture-0"];
  const entries = [
    ["free-a", "Free", true],
    ["free-b", "Free", true],
    ["no-token", "Free", false],
    ["banned", "Free", true],
    ["cant", "Free", true],
    ["pro-a", "Pro", true],
    ["pro-b", "Pro_Plus", true],
  ].map(([id, type, token]) => [
    id,
    {
      ...structuredClone(template),
      id,
      email: `${id}@example.invalid`,
      status: id === "banned" ? "error" : "active",
      lastError: id === "banned" ? "Account suspended" : undefined,
      credentials: {
        ...template.credentials,
        accessToken: token ? `fake-${id}` : "",
        region: "us-east-1",
        provider: "BuilderId",
        authMethod: "IdC",
      },
      subscription: {
        type,
        title: type,
        daysRemaining: 20,
        overageCapability: "OVERAGE_CAPABLE",
        upgradeCapability: id === "cant" ? "NOT_CAPABLE" : undefined,
      },
      usage: {
        ...template.usage,
        resourceDetail: { overageEnabled: id === "pro-b" },
      },
    },
  ]);
  window.__data.accounts = Object.fromEntries(entries);
  window.__data.activeAccountId = "free-a";
  window.__reg = {
    hold: false,
    pending: [],
    outcomes: [],
    attempts: 0,
    failUrlIds: ["free-b"],
    failOverageIds: ["pro-a"],
    failProbe: [],
    resultEmail: "registered@example.invalid",
    phaseFailure: "",
    proton: true,
  };
  window.__result = (email) => ({
    status: "success",
    email,
    password: "fake-password",
    refreshToken: "fake-refresh",
    accessToken: "fake-access",
    clientId: "fake-client",
    clientSecret: "fake-secret",
    region: "us-east-1",
    fingerprint: {
      chromeVer: "125.0.0.0",
      ua: "Fixture UA",
      gpuVendor: "Fixture",
      gpuModel: "Fixture GPU",
      canvasHash: 123,
      screen: { width: 1920, height: 1080 },
      exitIP: "2001:db8::1",
    },
  });
  window.__release = (outcome = null) => {
    const next = window.__reg.pending.shift();
    if (next) next(outcome);
  };
  window.api = new Proxy(
    {},
    {
      get(_, name) {
        if (name === "window" || String(name).startsWith("on"))
          return base[name];
        const responses = {
          registrationStatus: () => ({ inProgress: false }),
          registrationManualPhase1: () => ({
            success: window.__reg.phaseFailure !== "init",
            error: "Fixture init failed",
          }),
          registrationManualPhase2: () => ({
            success: window.__reg.phaseFailure !== "email",
            error: "Fixture email failed",
          }),
          registrationManualPhase3: () => ({
            success: window.__reg.phaseFailure !== "otp",
            result: window.__result(window.__reg.resultEmail),
            error: "Fixture otp failed",
          }),
          registrationCancel: () => {
            for (const resolve of window.__reg.pending.splice(0))
              resolve({ success: false, error: "Fixture cancelled" });
            return { success: true };
          },
          registrationStartAuto: async (config) => {
            const index = ++window.__reg.attempts;
            if (config.taskId)
              window.__emit("onRegistrationStep", {
                taskId: config.taskId,
                event: {
                  name: "waiting-otp",
                  ts: Date.now(),
                  email: `batch-${index}@example.invalid`,
                  exitIp: "192.0.2.1",
                },
              });
            if (window.__reg.hold)
              return new Promise((resolve) =>
                window.__reg.pending.push((value) =>
                  resolve(
                    value || {
                      success: true,
                      result: window.__result(`batch-${index}@example.invalid`),
                    },
                  ),
                ),
              );
            const result = window.__reg.outcomes.shift() || {
              success: true,
              result: window.__result(`batch-${index}@example.invalid`),
            };
            return result;
          },
          protonLoginStatus: () => ({
            success: true,
            loggedIn: window.__reg.proton,
          }),
          protonOpenLogin: () => ({
            success: true,
            loggedIn: window.__reg.proton,
          }),
          verifyAccountCredentials: () => ({
            success: true,
            data: {
              email: window.__reg.resultEmail,
              accessToken: "fake-verified",
              expiresIn: 3600,
              subscriptionType: "Free",
              subscriptionTitle: "Free Tier",
            },
          }),
          accountGetSubscriptions: () => ({
            success: true,
            plans: [
              {
                name: "Pro",
                qSubscriptionType: "Q_DEVELOPER_STANDALONE_PRO",
                description: {
                  title: "Pro",
                  billingInterval: "Monthly",
                  featureHeader: "Features",
                  features: ["Fixture"],
                },
                pricing: { amount: 20, currency: "USD" },
              },
              {
                name: "Pro+",
                qSubscriptionType: "Q_DEVELOPER_STANDALONE_PRO_PLUS",
                description: {
                  title: "Pro+",
                  billingInterval: "Monthly",
                  featureHeader: "Features",
                  features: ["Fixture"],
                },
                pricing: { amount: 40, currency: "USD" },
              },
            ],
          }),
          accountGetSubscriptionUrl: (...args) =>
            window.__reg.failUrlIds.includes(args[7])
              ? { success: false, error: "Fixture link unavailable" }
              : {
                  success: true,
                  url: `https://example.invalid/subscription/${args[7] || "registered"}`,
                },
          accountSetOverage: (...args) =>
            window.__reg.failOverageIds.includes(args[7])
              ? { success: false, error: "Fixture overage denied" }
              : { success: true },
          diagnoseHttpProbe: ({ url }) => ({
            success: !window.__reg.failProbe.includes(url),
            status: window.__reg.failProbe.includes(url) ? 410 : 200,
          }),
          openSubscriptionWindow: () => ({ success: true }),
        };
        if (name in responses)
          return async (...args) => {
            window.__calls.push({ name, args });
            return responses[name](...args);
          };
        return base[name];
      },
    },
  );
}
export const savedConfig = {
  mode: "manual",
  outlookData:
    "one@example.invalid----fake-password----fake-client----fake-refresh\ntwo@example.invalid----fake-password----fake-client----fake-refresh",
  fullName: "Fixture Person",
  batchCount: 2,
  batchInterval: 0,
  batchRetries: 0,
  batchConcurrency: 1,
  batchAutoImport: false,
  autoFetchProLink: false,
  proPlanType: "Q_DEVELOPER_STANDALONE_PRO",
  tempMailEmail: "inbox@example.invalid",
  tempMailEpin: "fake-epin",
  tempMailDomain: "temp.example.invalid",
  protonBaseEmail: "fixtureparent@protonmail.com",
  gptMailDomain: "gpt.example.invalid",
  gptMailInboxEmail: "",
  gptMailPrivatePassword: "fake-private",
  gptMailPrefix: "fixture",
  gptMailBaseURL: "https://example.invalid/mail",
  manualParentEmail: "",
  manualAnonymousEmail: false,
};
