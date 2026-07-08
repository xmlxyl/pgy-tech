/**
 * @param {object} params
 * @param {string} params.to
 * @param {string} params.subject
 * @param {string} params.bodyHtml
 * @param {string} [params.from]
 * @param {string} params.prizeTitle
 * @param {string} params.couponCode
 */
export async function sendLotteryEmail({
  to,
  subject,
  bodyHtml,
  from,
  prizeTitle,
  couponCode,
}) {
  const html = bodyHtml
    .replaceAll("{{coupon_code}}", couponCode)
    .replaceAll("{{prize_title}}", prizeTitle)
    .replaceAll("{{email}}", to);

  const apiKey = process.env.RESEND_API_KEY;
  const sender =
    from ||
    process.env.LOTTERY_EMAIL_FROM ||
    process.env.RESEND_FROM_EMAIL ||
    "onboarding@resend.dev";

  if (!apiKey) {
    console.warn("[lottery-email] RESEND_API_KEY not set; skipping email send", {
      to,
      couponCode,
    });
    return { sent: false, reason: "missing_api_key" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: sender,
      to: [to],
      subject: subject
        .replaceAll("{{coupon_code}}", couponCode)
        .replaceAll("{{prize_title}}", prizeTitle),
      html,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("[lottery-email] send failed", { status: response.status, text });
    return { sent: false, reason: "api_error" };
  }

  return { sent: true };
}
