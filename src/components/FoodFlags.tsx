import { label } from '../../shared/constants.ts';
import { flagFood } from '../../shared/nutrition.ts';
import type { Allergen, DietTag } from '../../shared/constants.ts';
import { useSession } from '../hooks.ts';
import { Badge } from './ui.tsx';

/** Shows warnings when a food contains one of the user's allergens or doesn't fit their diet. */
export function FoodFlags({ food, showApprox }: { food: { allergens: Allergen[]; dietTags: DietTag[]; isApproximate?: boolean }; showApprox?: boolean }) {
  const { me } = useSession();
  const profile = me?.profile;
  const flags = profile ? flagFood(food, { allergies: profile.allergies, dietaryPreference: profile.dietaryPreference }) : { allergens: [], dietConflict: false };
  return (
    <span className="flags">
      {flags.allergens.map((a) => (
        <Badge key={a} tone="danger" title={`Contains ${label(a).toLowerCase()}, which is in your allergy list`}>⚠ Contains {label(a).toLowerCase()}</Badge>
      ))}
      {flags.dietConflict && profile && <Badge tone="warn">Not {label(profile.dietaryPreference).toLowerCase()}</Badge>}
      {showApprox && food.isApproximate && <Badge title="Typical values; real products vary">≈ approx.</Badge>}
    </span>
  );
}

export function hasConflict(food: { allergens: Allergen[]; dietTags: DietTag[] }, profile: { allergies: Allergen[]; dietaryPreference: 'none' | DietTag } | null | undefined) {
  if (!profile) return false;
  const f = flagFood(food, profile);
  return f.allergens.length > 0 || f.dietConflict;
}
