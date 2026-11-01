export const ACTIVE_MEDIA_CATEGORIES = ["YouTube", "TV", "Movies"] as const;

export type ActiveMediaCategory =
  (typeof ACTIVE_MEDIA_CATEGORIES)[number];

export const FAVOURITE_CATEGORIES = ["TV", "Movies"] as const;

export type FavouriteCategory =
  (typeof FAVOURITE_CATEGORIES)[number];

export function isActiveMediaCategory(
  category: string,
): category is ActiveMediaCategory {
  return ACTIVE_MEDIA_CATEGORIES.some((activeCategory) => activeCategory === category);
}
