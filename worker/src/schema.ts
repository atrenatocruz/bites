const num = { type: "number" } as const;
const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;

export const MEAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_food", "meal_title", "meal_type_guess", "items", "kcal_range", "overall_confidence", "scale_reference_used", "follow_up_question", "notes"],
  properties: {
    is_food: { type: "boolean" },
    meal_title: { type: "string" },
    meal_type_guess: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack", "drink"] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "cooking_method", "grams", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "confidence", "assumption"],
        properties: {
          name: { type: "string" }, cooking_method: { type: "string" },
          grams: num, kcal: num, protein_g: num, carbs_g: num, fat_g: num, fiber_g: num,
          confidence: num, assumption: nullableString,
        },
      },
    },
    kcal_range: { type: "object", additionalProperties: false, required: ["low", "high"], properties: { low: num, high: num } },
    overall_confidence: num,
    scale_reference_used: nullableString,
    follow_up_question: nullableString,
    notes: nullableString,
  },
} as const;
