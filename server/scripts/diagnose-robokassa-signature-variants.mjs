import "dotenv/config";

import { createHash, randomUUID } from "node:crypto";

import { loadPaymentConfig } from "../src/payments/config.mjs";

const config = loadPaymentConfig();
const outSum = "1.00";
const receipt = JSON.stringify({
  items: [{
    name: "Диагностика оплаты ВИЖУФАСАД",
    quantity: 1,
    sum: 1,
    payment_method: "full_payment",
    payment_object: "service",
    tax: "none",
  }],
});
const encodedReceipt = encodeURIComponent(receipt);
const successUrl = `${config.siteOrigin}/app/balance`;
const failUrl = `${config.siteOrigin}/app/balance`;

const variants = [
  {
    name: "minimal_with_shp",
    signatureModifiers: [],
    queryModifiers: {},
    includeShp: true,
  },
  {
    name: "receipt_with_shp",
    signatureModifiers: [encodedReceipt],
    queryModifiers: { Receipt: encodedReceipt },
    includeShp: true,
  },
  {
    name: "receipt_returns_with_shp",
    signatureModifiers: [
      encodedReceipt,
      successUrl,
      "GET",
      failUrl,
      "GET",
    ],
    queryModifiers: {
      Receipt: encodedReceipt,
      SuccessUrl2: successUrl,
      SuccessUrl2Method: "GET",
      FailUrl2: failUrl,
      FailUrl2Method: "GET",
    },
    includeShp: true,
  },
  ...(config.result2Url ? [{
    name: "receipt_result2_returns_with_shp",
    signatureModifiers: [
      encodedReceipt,
      config.result2Url,
      successUrl,
      "GET",
      failUrl,
      "GET",
    ],
    queryModifiers: {
      Receipt: encodedReceipt,
      ResultUrl2: config.result2Url,
      SuccessUrl2: successUrl,
      SuccessUrl2Method: "GET",
      FailUrl2: failUrl,
      FailUrl2Method: "GET",
    },
    includeShp: true,
  }] : []),
];

let nextInvId = 910100;
for (const variant of variants) {
  const invId = String(nextInvId++);
  const paymentId = randomUUID();
  const custom = `Shp_payment=${paymentId}`;
  const signatureParts = [
    config.merchantLogin,
    outSum,
    invId,
    ...variant.signatureModifiers,
    config.password1,
    ...(variant.includeShp ? [custom] : []),
  ];
  const signature = createHash(config.signatureAlgorithm)
    .update(signatureParts.join(":"), "utf8")
    .digest("hex");
  const parameters = new URLSearchParams({
    MerchantLogin: config.merchantLogin,
    OutSum: outSum,
    InvId: invId,
    Description: "Диагностика интеграции",
    Culture: "ru",
    Encoding: "utf-8",
    Email: config.merchantEmail,
    ...variant.queryModifiers,
    ...(variant.includeShp ? { Shp_payment: paymentId } : {}),
    SignatureValue: signature,
  });
  const response = await fetch(`${config.checkoutUrl}?${parameters}`, { redirect: "manual" });
  const body = await response.text();
  const errorCode = body.match(/"error"\s*:\s*\{[^}]*"code"\s*:\s*(\d+)/u)?.[1] || null;
  const error29 = errorCode === "29" || /код ошибки:\s*29|неверн(?:ая|ый).*SignatureValue/iu.test(body);
  const paymentPage = (response.status === 302 || !/"order"\s*:\s*null/u.test(body)) && !error29;
  console.log(JSON.stringify({
    variant: variant.name,
    httpStatus: response.status,
    errorCode,
    error29,
    paymentPage,
    result2Configured: Boolean(config.result2Url),
  }));
}
