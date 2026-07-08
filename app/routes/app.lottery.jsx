import { useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import {
  ensureDefaultLotteryConfig,
  getLotteryPrizesForShop,
  getLotterySettingsForShop,
  saveLotteryPrizes,
  saveLotterySettings,
} from "../lib/lottery.server";
import { authenticate } from "../shopify.server";

/** @param {{ request: Request }} args */
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  await ensureDefaultLotteryConfig(session.shop);

  const [prizes, settings, entries] = await Promise.all([
    getLotteryPrizesForShop(session.shop),
    getLotterySettingsForShop(session.shop),
    prisma.lotteryEntry.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  const totalWeight = prizes
    .filter((p) => p.enabled)
    .reduce((sum, p) => sum + p.weight, 0);

  return {
    prizes: prizes.map((p) => ({
      slot: p.slot,
      title: p.title,
      imageUrl: p.imageUrl ?? "",
      weight: p.weight,
      discountPercent: p.discountPercent,
      enabled: p.enabled,
      probability:
        totalWeight > 0 && p.enabled
          ? ((p.weight / totalWeight) * 100).toFixed(1)
          : "0",
    })),
    settings: {
      emailSubject: settings?.emailSubject ?? "",
      emailBodyHtml: settings?.emailBodyHtml ?? "",
      emailFrom: settings?.emailFrom ?? "",
    },
    entries: entries.map((row) => ({
      id: row.id,
      email: row.email,
      prizeTitle: row.prizeTitle,
      couponCode: row.couponCode,
      createdAt: row.createdAt.toISOString(),
    })),
  };
};

/** @param {{ request: Request }} args */
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save-prizes") {
    /** @type {Array<{ slot: number, title: string, imageUrl: string, weight: number, discountPercent: number, enabled: boolean }>} */
    const prizes = [];
    for (let slot = 1; slot <= 6; slot += 1) {
      prizes.push({
        slot,
        title: String(formData.get(`title_${slot}`) ?? "").trim(),
        imageUrl: String(formData.get(`imageUrl_${slot}`) ?? "").trim(),
        weight: Number(formData.get(`weight_${slot}`) ?? 0),
        discountPercent: Number(formData.get(`discountPercent_${slot}`) ?? 0),
        enabled: formData.get(`enabled_${slot}`) === "on",
      });
    }

    if (prizes.some((p) => !p.title)) {
      return { ok: false, error: "每个奖品都需要填写名称" };
    }
    if (!prizes.some((p) => p.enabled && p.weight > 0)) {
      return { ok: false, error: "至少启用一个奖品并设置大于 0 的概率权重" };
    }

    await saveLotteryPrizes(session.shop, prizes);
    return { ok: true, message: "奖品配置已保存" };
  }

  if (intent === "save-email") {
    await saveLotterySettings(session.shop, {
      emailSubject: String(formData.get("emailSubject") ?? ""),
      emailBodyHtml: String(formData.get("emailBodyHtml") ?? ""),
      emailFrom: String(formData.get("emailFrom") ?? "") || null,
    });
    return { ok: true, message: "邮件模板已保存" };
  }

  return { ok: false, error: "未知操作" };
};

export default function LotteryPage() {
  const { prizes, settings, entries } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const [activeTab, setActiveTab] = useState("prizes");
  const isSaving = navigation.state === "submitting";

  return (
    <s-page heading="订阅抽奖" inlineSize="base">
      <s-section>
        <s-stack direction="inline" gap="small">
          <s-button
            variant={activeTab === "prizes" ? "primary" : "secondary"}
            onClick={() => setActiveTab("prizes")}
          >
            奖品配置
          </s-button>
          <s-button
            variant={activeTab === "email" ? "primary" : "secondary"}
            onClick={() => setActiveTab("email")}
          >
            邮件模板
          </s-button>
          <s-button
            variant={activeTab === "entries" ? "primary" : "secondary"}
            onClick={() => setActiveTab("entries")}
          >
            抽奖记录
          </s-button>
        </s-stack>
      </s-section>

      {actionData?.error ? (
        <s-banner tone="critical">{actionData.error}</s-banner>
      ) : null}
      {actionData?.ok && actionData?.message ? (
        <s-banner tone="success">{actionData.message}</s-banner>
      ) : null}

      {activeTab === "prizes" ? (
        <s-section heading="6 个奖品（均为优惠券）">
          <s-paragraph tone="subdued">
            设置每个奖品的名称、图片 URL、折扣比例与概率权重。权重越高，中奖概率越大。
          </s-paragraph>
          <Form method="post">
            <input type="hidden" name="intent" value="save-prizes" />
            <s-stack gap="base">
              {prizes.map((prize) => (
                <s-box
                  key={prize.slot}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                >
                  <s-stack gap="small">
                    <s-text fontWeight="semibold">奖品 {prize.slot}</s-text>
                    <label>
                      奖品名称
                      <input
                        type="text"
                        name={`title_${prize.slot}`}
                        defaultValue={prize.title}
                        style={{ display: "block", width: "100%", marginTop: 4 }}
                      />
                    </label>
                    <label>
                      图片 URL
                      <input
                        type="url"
                        name={`imageUrl_${prize.slot}`}
                        defaultValue={prize.imageUrl}
                        placeholder="https://..."
                        style={{ display: "block", width: "100%", marginTop: 4 }}
                      />
                    </label>
                    <s-stack direction="inline" gap="base">
                      <label>
                        折扣 (%)
                        <input
                          type="number"
                          name={`discountPercent_${prize.slot}`}
                          defaultValue={prize.discountPercent}
                          min={1}
                          max={100}
                          style={{ display: "block", marginTop: 4 }}
                        />
                      </label>
                      <label>
                        概率权重
                        <input
                          type="number"
                          name={`weight_${prize.slot}`}
                          defaultValue={prize.weight}
                          min={0}
                          max={1000}
                          style={{ display: "block", marginTop: 4 }}
                        />
                      </label>
                      <s-text tone="subdued">约 {prize.probability}%</s-text>
                    </s-stack>
                    <label>
                      <input
                        type="checkbox"
                        name={`enabled_${prize.slot}`}
                        defaultChecked={prize.enabled}
                      />{" "}
                      启用此奖品
                    </label>
                  </s-stack>
                </s-box>
              ))}
              <s-button type="submit" variant="primary" loading={isSaving}>
                保存奖品配置
              </s-button>
            </s-stack>
          </Form>
        </s-section>
      ) : null}

      {activeTab === "email" ? (
        <s-section heading="中奖邮件">
          <s-paragraph tone="subdued">
            抽奖成功后会向顾客发送优惠券邮件。请配置环境变量 RESEND_API_KEY，以及已验证的发件人域名。
            可用变量：{"{{coupon_code}}"}、{"{{prize_title}}"}、{"{{email}}"}
          </s-paragraph>
          <Form method="post">
            <input type="hidden" name="intent" value="save-email" />
            <s-stack gap="base">
              <label>
                发件人
                <input
                  type="email"
                  name="emailFrom"
                  defaultValue={settings.emailFrom}
                  placeholder="noreply@yourdomain.com"
                  style={{ display: "block", width: "100%", marginTop: 4 }}
                />
              </label>
              <label>
                邮件主题
                <input
                  type="text"
                  name="emailSubject"
                  defaultValue={settings.emailSubject}
                  style={{ display: "block", width: "100%", marginTop: 4 }}
                />
              </label>
              <label>
                邮件 HTML 正文
                <textarea
                  name="emailBodyHtml"
                  defaultValue={settings.emailBodyHtml}
                  rows={8}
                  style={{ display: "block", width: "100%", marginTop: 4 }}
                />
              </label>
              <s-button type="submit" variant="primary" loading={isSaving}>
                保存邮件模板
              </s-button>
            </s-stack>
          </Form>
        </s-section>
      ) : null}

      {activeTab === "entries" ? (
        <s-section heading="抽奖记录">
          {entries.length === 0 ? (
            <s-paragraph tone="subdued">暂无抽奖记录。</s-paragraph>
          ) : (
            <s-table variant="table" paginate={false}>
              <s-table-header-row>
                <s-table-header>邮箱</s-table-header>
                <s-table-header>奖品</s-table-header>
                <s-table-header>优惠券码</s-table-header>
                <s-table-header>时间</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {entries.map((row) => (
                  <s-table-row key={row.id}>
                    <s-table-cell>{row.email}</s-table-cell>
                    <s-table-cell>{row.prizeTitle}</s-table-cell>
                    <s-table-cell>
                      <code>{row.couponCode}</code>
                    </s-table-cell>
                    <s-table-cell>
                      {new Date(row.createdAt).toLocaleString("zh-CN")}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-section>
      ) : null}

      <s-section heading="主题区块">
        <s-paragraph>
          在主题编辑器中添加应用区块 <strong>订阅抽奖</strong>，顾客输入邮箱后即可参与抽奖。
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>在线商店 → 主题 → 自定义</s-list-item>
          <s-list-item>添加区块 → 应用 → 订阅抽奖</s-list-item>
          <s-list-item>保存并发布主题</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
