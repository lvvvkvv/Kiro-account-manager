// 全部为本机内存样例，禁止发起真实登录/订阅/代理请求。
export function accountFixture() {
  const base = window.api;
  window.__answers = {};
  window.__confirmAnswer = false;
  window.__alerts = [];
  window.__clipboard = "";
  window.alert = (m) => window.__alerts.push(String(m));
  window.confirm = (m) => {
    window.__alerts.push(String(m));
    return window.__confirmAnswer;
  };
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text) => {
        window.__clipboard = text;
      },
      readText: async () => window.__clipboard,
    },
  });
  window.__verified = (token = "new", provider = "BuilderId") => ({
    email:
      token === "existing"
        ? "fixture0@example.invalid"
        : `${token}@example.invalid`,
    userId: token === "existing" ? "fixture-user-0" : `user-${token}`,
    accessToken: `access-${token}`,
    refreshToken: token,
    expiresIn: 3600,
    subscriptionType: "Pro",
    subscriptionTitle: "KIRO PRO",
    daysRemaining: 20,
    usage: { current: 12.34, limit: 100, baseCurrent: 5, baseLimit: 50 },
  });
  window.api = new Proxy(base, {
    get(target, name) {
      if (name === "window" || String(name).startsWith("on"))
        return target[name];
      return async (...args) => {
        window.__calls.push({ name, args });
        if (name in window.__answers)
          return structuredClone(window.__answers[name]);
        if (name === "verifyAccountCredentials")
          return args[0].refreshToken === "bad"
            ? { success: false, error: "Fixture rejected" }
            : {
                success: true,
                data: window.__verified(args[0].refreshToken, args[0].provider),
              };
        if (name === "startBuilderIdLogin")
          return {
            success: true,
            userCode: "TEST-CODE",
            verificationUri: "https://login.example.invalid",
            interval: 0.05,
          };
        if (name === "startIamSsoLogin")
          return { success: true, authorizeUrl: "https://sso.example.invalid" };
        if (name === "startSocialLogin") return { success: true };
        if (name === "pollBuilderIdAuth" || name === "pollIamSsoAuth")
          return window.__pollResult || { success: true, completed: false };
        if (name === "exchangeSocialToken")
          return {
            success: true,
            accessToken: "social-access",
            refreshToken: "social-new",
            provider: window.__socialProvider || "Google",
          };
        if (name === "loadKiroCredentials")
          return {
            success: true,
            data: {
              refreshToken: "local-new",
              clientId: "local-client",
              clientSecret: "local-secret",
              region: "eu-west-1",
              authMethod: "IdC",
              provider: "BuilderId",
            },
          };
        if (name === "importFromSsoToken")
          return args[0] === "bad"
            ? { success: false, error: "Fixture rejected" }
            : { success: true, data: window.__verified(`sso-${args[0]}`) };
        if (name === "checkAccountStatus")
          return {
            success: true,
            data: {
              status: "active",
              usage: { ...args[0].usage, current: 42 },
              subscription: args[0].subscription,
            },
          };
        if (name === "refreshAccountToken")
          return {
            success: true,
            data: {
              accessToken: "refreshed-access",
              refreshToken: args[0].credentials.refreshToken,
              expiresIn: 3600,
              syncedToIde: true,
            },
          };
        if (name === "accountGetModels")
          return {
            success: true,
            models: [
              {
                id: "fixture-model",
                name: "Fixture model",
                description: "Example model",
                inputTypes: ["TEXT", "IMAGE"],
                maxInputTokens: 200000,
                maxOutputTokens: 16000,
                rateMultiplier: 1,
              },
            ],
          };
        if (name === "accountGetSubscriptions")
          return {
            success: true,
            plans: [
              {
                name: "Pro",
                qSubscriptionType: "PRO",
                pricing: { amount: 20 },
                description: {
                  title: "KIRO PRO",
                  billingInterval: "month",
                  features: ["Sample feature"],
                },
              },
              {
                name: "Pro_Plus",
                qSubscriptionType: "PRO_PLUS",
                pricing: { amount: 40 },
                description: {
                  title: "KIRO PRO+",
                  billingInterval: "month",
                  features: ["Sample feature"],
                },
              },
            ],
          };
        if (name === "accountGetSubscriptionUrl")
          return {
            success: true,
            url: "https://billing.example.invalid/manage",
          };
        if (
          [
            "switchAccount",
            "switchAccountCli",
            "logoutAccount",
            "proxyClearAccountSuspended",
            "cancelSocialLogin",
            "cancelBuilderIdLogin",
            "cancelIamSsoLogin",
            "openExternal",
            "openSubscriptionWindow",
          ].includes(name)
        )
          return { success: true };
        if (name === "exportToFile") return false;
        if (name === "importFromFile") return null;
        return target[name](...args);
      };
    },
  });
  window.__seed = async (count = 8) => {
    const { useAccountsStore } = await import("/src/store/accounts.ts");
    const now = Date.UTC(2026, 10, 26),
      template = window.__fixtureAccounts["fixture-0"];
    const accounts = new Map(
      Array.from({ length: count }, (_, i) => {
        const id = `fixture-${i}`;
        return [
          id,
          {
            ...structuredClone(template),
            id,
            email:
              i === 2
                ? "very.long.account.address.with.extra.characters@example.invalid"
                : `fixture${i}@example.invalid`,
            userId: `fixture-user-${i}`,
            nickname: `Fixture ${i}`,
            credentials: {
              ...template.credentials,
              accessToken: `access-${i}`,
              refreshToken: `refresh-${i}`,
              clientId: "fixture-client",
              clientSecret: "fixture-secret",
              region: "us-east-1",
              provider: "BuilderId",
              authMethod: "IdC",
              expiresAt: now + 86400000,
            },
            groupId: i % 2 ? "group-b" : "group-a",
            tags: i % 3 ? ["tag-a"] : ["tag-a", "tag-b"],
            isActive: i === 0,
            status: i === 1 ? "error" : i === 2 ? "expired" : "active",
            lastError: i === 1 ? "Account suspended" : undefined,
            createdAt: now + i,
            lastUsedAt: now + i,
            usage: {
              ...template.usage,
              current: i === 3 ? 125.67 : 22.34,
              percentUsed: i === 3 ? 1.2567 : 0.2234,
              lastUpdated: now,
              baseCurrent: 10,
              baseLimit: 50,
              freeTrialCurrent: 2,
              freeTrialLimit: 10,
              freeTrialExpiry: "2026-12-01",
              nextResetDate: "2026-12-01",
              bonuses: [
                { code: "b1", name: "Bonus one", current: 1, limit: 20 },
                { code: "b2", name: "Bonus two", current: 2, limit: 20 },
              ],
            },
          },
        ];
      }),
    );
    useAccountsStore.setState({
      accounts,
      groups: new Map([
        [
          "group-a",
          {
            id: "group-a",
            name: "Group A",
            color: "#3b82f6",
            order: 0,
            createdAt: now,
          },
        ],
        [
          "group-b",
          {
            id: "group-b",
            name: "Group B",
            color: "#22c55e",
            order: 1,
            createdAt: now,
          },
        ],
      ]),
      tags: new Map([
        ["tag-a", { id: "tag-a", name: "Blue", color: "#ff3b82f6" }],
        ["tag-b", { id: "tag-b", name: "Green", color: "#8022c55e" }],
      ]),
      activeAccountId: "fixture-0",
      selectedIds: new Set(),
      filter: {},
      activeGroupTab: "all",
      privacyMode: false,
      proxyPool: new Map([
        [
          "proxy-a",
          {
            id: "proxy-a",
            url: "http://proxy.example.invalid:8080",
            host: "proxy.example.invalid",
            port: 8080,
            protocol: "http",
            enabled: true,
            status: "alive",
            label: "Fixture proxy",
            latencyMs: 20,
          },
        ],
      ]),
      accountProxyBindings: {},
      switchTarget: "both",
    });
    window.__calls = [];
    window.__alerts = [];
    window.__answers = {};
    window.__pollResult = null;
  };
}
