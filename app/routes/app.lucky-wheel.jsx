import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getLuckyWheelSetting,
  listRecentLuckyWheelClaims,
  saveLuckyWheelSetting,
} from "../lib/lucky-wheel.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const [setting, claims] = await Promise.all([
    getLuckyWheelSetting(session.shop),
    listRecentLuckyWheelClaims(session.shop),
  ]);
  return { setting, claims };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  return saveLuckyWheelSetting(session.shop, formData);
};

export default function LuckyWheelSettingsPage() {
  const { setting, claims } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const formKey = [
    setting.enabled,
    setting.codePrefix,
    setting.codeStartsAt,
    setting.codeEndsAt,
    setting.prizes
      .map((prize) => `${prize.label}:${prize.percentOff}:${prize.probability}`)
      .join("|"),
  ].join("~");

  return (
    <s-page heading="Lucky Wheel" inlineSize="base">
      <div style={PAGE_CONTENT_STYLE}>
        {actionData?.message ? (
          <s-section>
            <s-banner tone={actionData.ok ? "success" : "critical"}>
              {actionData.message}
            </s-banner>
          </s-section>
        ) : null}

        {setting.setupError ? (
          <s-section>
            <s-banner tone="critical">{setting.setupError}</s-banner>
          </s-section>
        ) : null}

        <Form method="post" key={formKey}>
          <s-section heading="活动设置">
            <s-stack gap="base">
              <s-checkbox
                name="enabled"
                value="true"
                label="启用幸运转盘"
                defaultChecked={setting.enabled}
              />
              <s-text-field
                label="优惠码前缀"
                name="codePrefix"
                defaultValue={setting.codePrefix}
                helpText="默认 LW-，后面再接 8 位不重复的英文和数字"
              />
              <s-text-field
                label="优惠码开始时间 (PDT)"
                name="codeStartsAt"
                type="datetime-local"
                step={1}
                defaultValue={setting.codeStartsAt}
              />
              <s-text-field
                label="优惠码结束时间 (PDT)"
                name="codeEndsAt"
                type="datetime-local"
                step={1}
                defaultValue={setting.codeEndsAt}
                helpText="默认 2026-11-18 00:00:00 到 2026-12-31 23:59:59（PDT），覆盖黑五和网一"
              />
            </s-stack>
          </s-section>

          <s-section heading="奖池（3 个奖励，合计概率 100%）">
            <s-stack gap="base">
              {setting.prizes.map((prize, index) => (
                <div key={`prize-${index}`} style={RULE_ROW_STYLE}>
                  <s-grid gridTemplateColumns="1.4fr 1fr 1fr" gap="base">
                    <s-text-field
                      label="转盘文案"
                      name={`label${index}`}
                      defaultValue={prize.label}
                    />
                    <s-text-field
                      label="折扣"
                      name={`percentOff${index}`}
                      type="number"
                      min={0.01}
                      max={100}
                      step={0.01}
                      defaultValue={prize.percentOff}
                      suffix="%"
                    />
                    <s-text-field
                      label="概率"
                      name={`probability${index}`}
                      type="number"
                      min={0}
                      max={100}
                      step={0.001}
                      defaultValue={prize.probability}
                      suffix="%"
                    />
                  </s-grid>
                </div>
              ))}
              <s-text tone="subdued">
                转盘固定 6 个扇区，3 个奖励各出现两次。概率按奖励计算，不按扇区平分。默认 Extra 2% OFF 60%、Extra 3% OFF 30%、Extra 5% OFF 10%。折扣码可与商品折扣、订单折扣和运费折扣叠加，对方活动也要允许叠加。
              </s-text>
            </s-stack>
          </s-section>

          <s-section>
            <s-button
              type="submit"
              variant="primary"
              disabled={isSubmitting || Boolean(setting.setupError)}
            >
              {isSubmitting ? "Saving..." : "Save settings"}
            </s-button>
          </s-section>
        </Form>

        <s-section heading="前台接入">
          <s-paragraph>
            部署应用后，在主题编辑器打开页面模板，点「添加分区」，在「应用」里选择 Lucky Wheel。左边上传转盘图，点击图片打开抽奖弹框。每个邮箱只能抽一次，中奖后会创建仅该客户可用、限用 1 次的百分比折扣码。
          </s-paragraph>
          <s-paragraph>
            顾客抽过之后，这个页面右下角会显示圆点，点击可查看优惠码。
          </s-paragraph>
        </s-section>

        <s-section heading="最近领取">
          {claims.length ? (
            <div style={{ overflowX: "auto" }}>
              <table style={TABLE_STYLE}>
                <thead>
                  <tr>
                    <th style={TH_STYLE}>邮箱</th>
                    <th style={TH_STYLE}>电话</th>
                    <th style={TH_STYLE}>优惠码</th>
                    <th style={TH_STYLE}>折扣</th>
                    <th style={TH_STYLE}>时间 (UTC)</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((claim) => (
                    <tr key={claim.couponCode}>
                      <td style={TD_STYLE}>{claim.email}</td>
                      <td style={TD_STYLE}>{claim.phone}</td>
                      <td style={TD_STYLE}>{claim.couponCode}</td>
                      <td style={TD_STYLE}>{claim.label}</td>
                      <td style={TD_STYLE}>{claim.createdLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <s-text tone="subdued">还没有人抽奖。</s-text>
          )}
        </s-section>
      </div>
    </s-page>
  );
}

const PAGE_CONTENT_STYLE = {
  maxWidth: "980px",
  width: "min(980px, 100%)",
  display: "grid",
  gap: "1rem",
};

const RULE_ROW_STYLE = {
  padding: "0.75rem",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
};

const TABLE_STYLE = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
};

const TH_STYLE = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid #e5e7eb",
  whiteSpace: "nowrap",
};

const TD_STYLE = {
  padding: "8px 10px",
  borderBottom: "1px solid #f3f4f6",
  verticalAlign: "top",
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
