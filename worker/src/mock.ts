import type { AnalyzeResult } from "@bites/shared";

export const MOCK_RESULT: AnalyzeResult = {
  isFood: true,
  title: "Bitoque",
  mealType: "lunch",
  items: [
    { name: "Bife", cookingMethod: "grelhado", grams: 150, kcal: 300, protein: 40, carbs: 0, fat: 15, fiber: 0, confidence: 0.8, assumption: null },
    { name: "Batata frita", cookingMethod: "frita", grams: 150, kcal: 470, protein: 5, carbs: 60, fat: 23, fiber: 5, confidence: 0.7, assumption: "óleo de fritura" },
  ],
  totals: { kcal: 770, protein: 45, carbs: 60, fat: 38 },
  kcalRange: { low: 650, high: 900 },
  confidence: 0.75,
  scaleReference: "prato 27 cm",
  followUpQuestion: "A batata é frita ou assada?",
  notes: null,
};
