import {render} from 'preact';

const benefits = [
  {
    icon: 'truck',
    label: 'FAST SHIPPING',
  },
  {
    icon: 'return',
    label: '30-DAY RETURN',
  },
  {
    icon: 'check-circle',
    label: 'LONG-TERM WARRANTY',
  },
  {
    icon: 'question-circle',
    label: 'WE ARE HERE TO HELP',
  },
];

export default () => {
  render(<CheckoutBenefits />, document.body);
};

function CheckoutBenefits() {
  return (
    <s-box
      accessibilityLabel="Checkout benefits"
      border="base"
      borderRadius="base"
      background="base"
      padding="large"
    >
      <s-stack direction="block" gap="large">
        {benefits.map((benefit) => (
          <BenefitItem key={benefit.label} benefit={benefit} />
        ))}
      </s-stack>
    </s-box>
  );
}

function BenefitItem({benefit}) {
  return (
    <s-stack direction="inline" alignItems="center" gap="base">
      <s-box inlineSize="32px">
        <s-icon type={benefit.icon} size="large" tone="neutral" />
      </s-box>
      <s-text type="strong">{benefit.label}</s-text>
    </s-stack>
  );
}
