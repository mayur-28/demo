// Single source of truth for enumerations used by the API, the UI and the tests.

export const ALLERGENS = ['dairy', 'egg', 'gluten', 'peanut', 'tree_nut', 'soy', 'fish', 'shellfish', 'sesame'] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const DIET_PREFERENCES = ['none', 'vegetarian', 'vegan', 'pescatarian'] as const;
export type DietPreference = (typeof DIET_PREFERENCES)[number];
/** Tags a food can carry to say which diets it fits. */
export const DIET_TAGS = ['vegetarian', 'vegan', 'pescatarian'] as const;
export type DietTag = (typeof DIET_TAGS)[number];

export const EQUIPMENT = ['bodyweight', 'dumbbells', 'barbell', 'kettlebell', 'bands', 'pullup_bar', 'bench', 'machine', 'cardio_machine'] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export const MUSCLE_GROUPS = ['chest', 'back', 'shoulders', 'arms', 'legs', 'glutes', 'core', 'full_body', 'cardio'] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const TRAINING_TYPES = ['strength', 'hypertrophy', 'cardio', 'mobility', 'hiit'] as const;
export type TrainingType = (typeof TRAINING_TYPES)[number];

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'active', 'very_active'] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

export const FITNESS_GOALS = ['lose_weight', 'maintain', 'gain_muscle', 'improve_endurance', 'general_fitness'] as const;
export type FitnessGoal = (typeof FITNESS_GOALS)[number];

export const SEX_OPTIONS = ['female', 'male', 'unspecified'] as const;
export type Sex = (typeof SEX_OPTIONS)[number];

export const UNIT_SYSTEMS = ['metric', 'imperial'] as const;
export type UnitSystem = (typeof UNIT_SYSTEMS)[number];

export const SERVING_UNITS = ['g', 'ml', 'piece', 'cup', 'tbsp', 'slice', 'scoop'] as const;
export type ServingUnit = (typeof SERVING_UNITS)[number];

/** Monday-first weekday labels; index matches `day_index` in plans. */
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export const ROLES = ['admin', 'user'] as const;
export type Role = (typeof ROLES)[number];

// Safety limits
export const MAX_SERVINGS = 20;
export const MIN_CALORIE_GOAL = 1200;
export const MAX_CALORIE_GOAL = 5000;

const LABEL_OVERRIDES: Record<string, string> = {
  tree_nut: 'Tree nuts',
  pullup_bar: 'Pull-up bar',
  cardio_machine: 'Cardio machine',
  full_body: 'Full body',
  hiit: 'HIIT',
  very_active: 'Very active',
  lose_weight: 'Lose weight',
  gain_muscle: 'Build muscle',
  improve_endurance: 'Improve endurance',
  general_fitness: 'General fitness',
  none: 'No preference',
  tbsp: 'tbsp',
  g: 'g',
  ml: 'ml',
};

/** Human-readable label for any enum value above. */
export function label(value: string): string {
  if (LABEL_OVERRIDES[value]) return LABEL_OVERRIDES[value];
  const s = value.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
