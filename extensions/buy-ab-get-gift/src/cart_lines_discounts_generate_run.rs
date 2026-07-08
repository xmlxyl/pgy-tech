use super::schema;
use shopify_function::prelude::*;
use shopify_function::Result;

const PRODUCT_A_ID: &str = "gid://shopify/Product/8957262070010";
const PRODUCT_B_ID: &str = "gid://shopify/Product/8671834538234";
const GIFT_VARIANT_ID: &str = "gid://shopify/ProductVariant/47347415777530";

#[shopify_function]
fn cart_lines_discounts_generate_run(
    input: schema::cart_lines_discounts_generate_run::Input,
) -> Result<schema::CartLinesDiscountsGenerateRunResult> {
    let has_product_discount_class = input
        .discount()
        .discount_classes()
        .contains(&schema::DiscountClass::Product);

    if !has_product_discount_class {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    }

    let mut has_product_a = false;
    let mut has_product_b = false;
    let mut gift_cart_line_id: Option<String> = None;

    for line in input.cart().lines().iter() {
        if let schema::cart_lines_discounts_generate_run::input::cart::lines::Merchandise::ProductVariant(
            variant,
        ) = &line.merchandise()
        {
            let product_id = variant.product().id().as_str();
            if product_id == PRODUCT_A_ID {
                has_product_a = true;
            } else if product_id == PRODUCT_B_ID {
                has_product_b = true;
            }

            if variant.id().as_str() == GIFT_VARIANT_ID {
                gift_cart_line_id = Some(line.id().clone());
            }
        }
    }

    if !has_product_a || !has_product_b {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    }

    let gift_line_id = match gift_cart_line_id {
        Some(id) => id,
        None => return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] }),
    };

    Ok(schema::CartLinesDiscountsGenerateRunResult {
        operations: vec![schema::CartOperation::ProductDiscountsAdd(
            schema::ProductDiscountsAddOperation {
                selection_strategy: schema::ProductDiscountSelectionStrategy::First,
                candidates: vec![schema::ProductDiscountCandidate {
                    targets: vec![schema::ProductDiscountCandidateTarget::CartLine(
                        schema::CartLineTarget {
                            id: gift_line_id,
                            quantity: Some(1),
                        },
                    )],
                    message: Some("购买产品A+产品B，赠送礼品".to_string()),
                    value: schema::ProductDiscountCandidateValue::Percentage(schema::Percentage {
                        value: Decimal(100.0),
                    }),
                    associated_discount_code: None,
                    prerequisites: None,
                }],
            },
        )],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use shopify_function::{run_function_with_input, Result};

    #[test]
    fn applies_free_gift_when_both_products_are_in_cart() -> Result<()> {
        let result = run_function_with_input(
            cart_lines_discounts_generate_run,
            r#"
            {
              "cart": {
                "lines": [
                  {
                    "id": "gid://shopify/CartLine/1",
                    "merchandise": {
                      "__typename": "ProductVariant",
                      "id": "gid://shopify/ProductVariant/111",
                      "product": { "id": "gid://shopify/Product/8957262070010" }
                    }
                  },
                  {
                    "id": "gid://shopify/CartLine/2",
                    "merchandise": {
                      "__typename": "ProductVariant",
                      "id": "gid://shopify/ProductVariant/222",
                      "product": { "id": "gid://shopify/Product/8671834538234" }
                    }
                  },
                  {
                    "id": "gid://shopify/CartLine/3",
                    "merchandise": {
                      "__typename": "ProductVariant",
                      "id": "gid://shopify/ProductVariant/47347415777530",
                      "product": { "id": "gid://shopify/Product/8794281214202" }
                    }
                  }
                ]
              },
              "discount": { "discountClasses": ["PRODUCT"] }
            }
            "#,
        )?;

        assert_eq!(result.operations.len(), 1);
        Ok(())
    }

    #[test]
    fn skips_discount_when_product_b_is_missing() -> Result<()> {
        let result = run_function_with_input(
            cart_lines_discounts_generate_run,
            r#"
            {
              "cart": {
                "lines": [
                  {
                    "id": "gid://shopify/CartLine/1",
                    "merchandise": {
                      "__typename": "ProductVariant",
                      "id": "gid://shopify/ProductVariant/111",
                      "product": { "id": "gid://shopify/Product/8957262070010" }
                    }
                  },
                  {
                    "id": "gid://shopify/CartLine/3",
                    "merchandise": {
                      "__typename": "ProductVariant",
                      "id": "gid://shopify/ProductVariant/47347415777530",
                      "product": { "id": "gid://shopify/Product/8794281214202" }
                    }
                  }
                ]
              },
              "discount": { "discountClasses": ["PRODUCT"] }
            }
            "#,
        )?;

        assert!(result.operations.is_empty());
        Ok(())
    }
}
