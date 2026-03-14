export type RawAuthorRelation = {
  author_id: string;
  authors: { id: string; name: string } | { id: string; name: string }[] | null;
};

export function normalizeAuthors(relations: RawAuthorRelation[] | null): string[] {
  if (!relations || relations.length === 0) return [];

  const names = new Set<string>();

  for (const relation of relations) {
    const authors = relation.authors;
    if (!authors) continue;

    if (Array.isArray(authors)) {
      for (const author of authors) {
        if (author.name) names.add(author.name);
      }
      continue;
    }

    if (authors.name) names.add(authors.name);
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

export function formatAuthorLine(authors: string[]): string {
  return authors.length > 0 ? authors.join(", ") : "Unknown author";
}

export function formatPublicationLabel(
  publicationDate: string | null | undefined,
  publicationYear: number | null | undefined
): string {
  if (publicationDate) {
    const parsed = new Date(publicationDate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      });
    }
  }

  if (publicationYear) return String(publicationYear);
  return "Unknown";
}

export function normalizeTags(tags: string[] | null): string[] {
  return tags ?? [];
}

export function formatTagsInline(tags: string[]): string {
  return tags.length > 0 ? tags.join(", ") : "None";
}
