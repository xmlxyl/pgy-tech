/* eslint-disable react/prop-types */
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getMysteryBoxSetting,
  saveMysteryBoxSetting,
} from "../lib/mystery-box.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const setting = await getMysteryBoxSetting(session.shop);
  return { setting };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  return saveMysteryBoxSetting(session.shop, formData, admin);
};

export default function MysteryBoxSettingsPage() {
  const { setting } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <s-page heading="Lucky box settings" inlineSize="base">
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
          <s-section heading="Campaign rules">
            <s-stack gap="base">
              <s-text-field
                label="Order start date/time (PDT)"
                name="startDate"
                type="datetime-local"
                step={1}
                defaultValue={setting.startDate}
              />
              <s-text-field
                label="Minimum order amount"
                name="minOrderAmount"
                type="number"
                min={0}
                step={0.01}
                defaultValue={setting.minOrderAmount}
              />
              <s-text-field
                label="Feishu webhook"
                name="webhookUrl"
                defaultValue={setting.webhookUrl}
              />
            </s-stack>
          </s-section>

          <RuleSection title="US rules" prefix="us" rules={setting.usRules} />
          <RuleSection
            title="Non-US rules"
            prefix="intl"
            rules={setting.intlRules}
          />

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
      </div>
    </s-page>
  );
}

function RuleSection({ title, prefix, rules }) {
  return (
    <s-section heading={title}>
      <s-stack gap="base">
        {[0, 1, 2].map((index) => {
          const prize = rules.prizes[index] || {};
          return (
            <div key={`${prefix}-${index}`} style={RULE_ROW_STYLE}>
              <s-grid gridTemplateColumns="2fr 1fr" gap="base">
                <s-text-field
                  label={`Prize ${index + 1} SKU`}
                  name={`${prefix}Sku${index}`}
                  defaultValue={prize.sku || ""}
                />
                <s-text-field
                  label="Win probability"
                  name={`${prefix}Probability${index}`}
                  type="number"
                  min={0}
                  max={100}
                  step={0.001}
                  defaultValue={prize.probability || 0}
                  suffix="%"
                />
              </s-grid>
            </div>
          );
        })}
        <div style={RULE_ROW_STYLE}>
          <s-text-field
            label="No-prize probability"
            name={`${prefix}NoPrizeProbability`}
            type="number"
            min={0}
            max={100}
            step={0.001}
            defaultValue={rules.noPrizeProbability || 0}
            suffix="%"
          />
        </div>
        <s-text tone="subdued">
          The three SKU probabilities plus the no-prize probability must equal
          100.
        </s-text>
      </s-stack>
    </s-section>
  );
}

const PAGE_CONTENT_STYLE = {
  maxWidth: "980px",
  width: "min(980px, 100%)",
  display: "grid",
  gap: "16px",
};

const RULE_ROW_STYLE = {
  marginBlockEnd: "16px",
};

export const headers = (headersArgs) => boundary.headers(headersArgs);
