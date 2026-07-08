use super::schema;
use shopify_function::prelude::*;
use shopify_function::Result;

#[shopify_function]
fn cart_delivery_options_discounts_generate_run(
    input: schema::cart_delivery_options_discounts_generate_run::Input,
) -> Result<schema::CartDeliveryOptionsDiscountsGenerateRunResult> {
    let has_shipping_discount_class = input
        .discount()
        .discount_classes()
        .contains(&schema::DiscountClass::Shipping);

    if !has_shipping_discount_class {
        return Ok(schema::CartDeliveryOptionsDiscountsGenerateRunResult { operations: vec![] });
    }

    Ok(schema::CartDeliveryOptionsDiscountsGenerateRunResult { operations: vec![] })
}
