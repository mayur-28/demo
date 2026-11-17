import type {
  ActivityLevel, Allergen, DietPreference, DietTag, Equipment, FitnessGoal, MealType, MuscleGroup, Role, ServingUnit,
  Sex, TrainingType, UnitSystem,
} from './constants.ts';
import type { Macros } from './nutrition.ts';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export interface Targets extends Macros {
  isCustom: boolean;
  /** Estimated maintenance calories (Mifflin-St Jeor × activity), for context only. */
  maintenance: number;
}

export interface Profile {
  name: string;
  age: number;
  heightCm: number;
  weightKg: number;
  sex: Sex;
  units: UnitSystem;
  activityLevel: ActivityLevel;
  goal: FitnessGoal;
  dietaryPreference: DietPreference;
  allergies: Allergen[];
  otherAllergies: string;
  equipment: Equipment[];
  customTargets: Macros | null;
}

export interface Me {
  user: User;
  profile: Profile | null;
  targets: Targets | null;
}

export interface Exercise {
  id: number;
  name: string;
  muscleGroup: MuscleGroup;
  trainingType: TrainingType;
  equipment: Equipment;
  instructions: string;
  archived: boolean;
}

export interface Food extends Macros {
  id: number;
  name: string;
  brand: string;
  servingSize: number;
  servingUnit: ServingUnit;
  allergens: Allergen[];
  dietTags: DietTag[];
  isApproximate: boolean;
  archived: boolean;
}

export type PlanKind = 'template' | 'personal';

export interface PlanMeta {
  id: number;
  kind: PlanKind;
  ownerId: number | null;
  ownerName: string | null;
  sourcePlanId: number | null;
  sourcePlanName: string | null;
  name: string;
  description: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkoutItem {
  id: number;
  exerciseId: number;
  exercise: Exercise;
  position: number;
  sets: number;
  reps: number | null;
  durationSec: number | null;
  restSec: number;
  weightKg: number | null;
  notes: string;
}

export interface WorkoutDay {
  id: number;
  dayIndex: number;
  name: string;
  focus: MuscleGroup | null;
  trainingType: TrainingType | null;
  items: WorkoutItem[];
}

export interface WorkoutPlan extends PlanMeta {
  days: WorkoutDay[];
}

export interface WorkoutPlanSummary extends PlanMeta {
  dayCount: number;
  exerciseCount: number;
}

export interface DietItem {
  id: number;
  dayIndex: number;
  mealType: MealType;
  foodId: number;
  food: Food;
  servings: number;
  position: number;
  nutrition: Macros;
}

export interface DietPlan extends PlanMeta {
  items: DietItem[];
  /** Totals per weekday index (0 = Monday). */
  dayTotals: Record<number, Macros>;
}

export interface DietPlanSummary extends PlanMeta {
  itemCount: number;
  avgDailyCalories: number;
}

export interface FoodLogEntry {
  id: number;
  date: string;
  mealType: MealType;
  foodId: number | null;
  foodName: string;
  servingSize: number;
  servingUnit: ServingUnit;
  servings: number;
  perServing: Macros;
  nutrition: Macros;
  isApproximate: boolean;
  allergens: Allergen[];
  dietTags: DietTag[];
}

export interface DaySummary {
  date: string;
  entries: FoodLogEntry[];
  totals: Macros;
  byMeal: Record<MealType, Macros>;
  hasApproximate: boolean;
}

export interface LoggedSet {
  reps: number | null;
  weightKg: number | null;
  durationSec: number | null;
}

export interface WorkoutLogEntry {
  id: number;
  exerciseId: number | null;
  exerciseName: string;
  position: number;
  completed: boolean;
  sets: LoggedSet[];
}

export interface WorkoutLog {
  id: number;
  date: string;
  title: string;
  planId: number | null;
  dayIndex: number | null;
  notes: string;
  createdAt: string;
  entries: WorkoutLogEntry[];
  completedCount: number;
  totalVolumeKg: number;
}

export interface DailyPoint extends Macros {
  date: string;
  workouts: number;
  logged: boolean;
}

export interface ExerciseTrend {
  exerciseId: number;
  name: string;
  sessions: number;
  firstBestKg: number;
  latestBestKg: number;
  firstDate: string;
  latestDate: string;
}

export interface WeekSummary {
  start: string;
  end: string;
  plannedWorkouts: number;
  completedWorkouts: number;
  daysLogged: number;
  /** Logged days used for averages (excludes the in-progress reference day). */
  avgDays: number;
  avg: Macros;
}

export interface Progress {
  days: DailyPoint[];
  week: WeekSummary;
  weights: { date: string; weightKg: number }[];
  exerciseTrends: ExerciseTrend[];
  targets: Targets | null;
}

export interface Dashboard {
  date: string;
  targets: Targets | null;
  today: DaySummary;
  workout: {
    plan: { id: number; name: string } | null;
    day: WorkoutDay | null;
    loggedToday: WorkoutLog[];
  };
  meals: {
    plan: { id: number; name: string } | null;
    items: DietItem[];
  };
  week: WeekSummary;
}

export interface AdminUserRow {
  id: number;
  name: string;
  email: string;
  role: Role;
  onboarded: boolean;
  activeWorkoutPlan: string | null;
  activeDietPlan: string | null;
}
