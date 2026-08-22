import "dotenv/config";

import { randomUUID } from "node:crypto";

import { loadPaymentConfig } from "../src/payments/config.mjs";
import { RobokassaPaymentProvider } from "../src/payments/providers/robokassa.mjs";

function fail(message) {
  console.error(`ROBOKASSA_LIVE_SMOKE_FAILED ${message}`);
  process.exitCode = 1;
}

const config = loadPaymentConfig();

if (process.env.ALLOW_LIVE_PROVIDER_SMOKE !== "true") {
  fail("set ALLOW_LIVE_PROVIDER_SMOKE=true to contact the live provider");
} else if (!config.enabled) {
  fail("payments are disabled");
} else if (config.testMode) {
  fail("PAYMENT_TEST_MODE must be false");
} else {
  const provider = new RobokassaPaymentProvider(config);
  const checkout = provider.createCheckout({
    id: randomUUID(),
    amount_minor: 100,
    provider_payment_id: "900004",
    description: "Диагностика боевого подключения ВИЖУФАСАД",
    checkout_expires_at: new Date(Date.now() + 10 * 60_000),
  }, { email: config.merchantEmail });

  const checkoutUrl = new URL(checkout.url);
  if (checkoutUrl.searchParams.has("IsTest")) {
    fail("checkout unexpectedly contains IsTest");
  } else {
    const response = await fetch(checkoutUrl, { redirect: "manual" });
    const body = await response.text();
    const providerErrorCode = body.match(/"error"\s*:\s*\{[^}]*"code"\s*:\s*(\d+)/u)?.[1] || null;
    const signatureRejected = providerErrorCode === "29"
      || /код ошибки:\s*29|signaturevalue|неверн(?:ая|ый).*подпис/iu.test(body);
    const redirectHost = response.headers.get("location")
      ? new URL(response.headers.get("location"), checkoutUrl).hostname
      : null;
    const accepted = !signatureRejected
      && response.status >= 200
      && response.status < 400
      && (response.status === 302 || !/"order"\s*:\s*null/u.test(body))
      && (!redirectHost || redirectHost.endsWith("robokassa.ru"));

    if (!accepted) {
      fail(`provider rejected checkout (status=${response.status}, errorCode=${providerErrorCode || "unknown"}, signatureRejected=${signatureRejected})`);
    } else {
      console.log(JSON.stringify({
        status: "accepted",
        provider: provider.name,
        httpStatus: response.status,
        redirectedToProvider: Boolean(redirectHost),
        testMode: config.testMode,
        siteOrigin: config.siteOrigin,
        refundsConfigured: Boolean(config.password3),
      }));
    }
  }
}
