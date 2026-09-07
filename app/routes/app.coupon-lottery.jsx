import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getCouponLotterySetting,
  saveCouponLotterySetting,
} from "../lib/coupon-lottery.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const setting = await getCouponLotterySetting(session.shop);
  return { setting };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  return saveCouponLotterySetting(session.shop, formData);
};

export default function CouponLotterySettingsPage() {
  const { setting } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <s-page heading="Coupon Lottery" inlineSize="base">
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

        <Form method="post">
          <s-section heading="活动设置">
            <s-stack gap="base">
              <s-checkbox
                name="enabled"
                value="true"
                label="启用邮箱订阅抽奖"
                defaultChecked={setting.enabled}
              />
              <s-text-field
                label="优惠码前缀"
                name="codePrefix"
                defaultValue={setting.codePrefix}
                helpText="默认 PGY-，完整格式为 PGY-XXXXXXXX（后 8 位英文数字随机且不重复）"
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
                helpText="默认：9月18日 00:00:00 ~ 9月30日 23:59:59（PDT）"
              />
            </s-stack>
          </s-section>

          <s-section heading="奖池概率（合计须为 100%）">
            <s-stack gap="base">
              {setting.prizes.map((prize, index) => (
                <div key={`prize-${index}`} style={RULE_ROW_STYLE}>
                  <s-grid gridTemplateColumns="1fr 1fr 1fr 1fr" gap="base">
                    <s-text-field
                      label="展示文案"
                      name={`label${index}`}
                      defaultValue={prize.label}
                    />
                    <s-text-field
                      label="满额门槛 ($)"
                      name={`minSpend${index}`}
                      type="number"
                      min={0}
                      step={0.01}
                      defaultValue={prize.minSpend}
                    />
                    <s-text-field
                      label="减免金额 ($)"
                      name={`discountAmount${index}`}
                      type="number"
                      min={0}
                      step={0.01}
                      defaultValue={prize.discountAmount}
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
                示例：满 $20 EXTRA $1.1 OFF → 门槛 20，减免 1.1，概率 44%。
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
            在主题编辑器中添加 App block「Coupon Lottery」。页面会直接展示周年盲盒活动区，点击 Open My Coupon 后弹出邮箱表单领取唯一优惠码。每个邮箱仅可领取一次。
          </s-paragraph>
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

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
