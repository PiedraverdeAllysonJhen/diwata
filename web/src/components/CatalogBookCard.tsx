import { KeyboardEvent, MouseEvent, ReactNode } from "react";

type CatalogBookCardProps = {
  title: string;
  subtitle: string;
  authorLine: string;
  coverImageUrl: string | null;
  availabilityLabel: string;
  availabilityTone: "available" | "borrowed" | "reserved";
  metaItems: string[];
  actionLabel: string;
  actionDisabled: boolean;
  hasBorrowedBefore: boolean;
  onOpenDetails: () => void;
  onAction: () => void;
  actionVariant?: "primary" | "soft";
  headerAccessory?: ReactNode;
};

function onCardKeyDown(
  event: KeyboardEvent<HTMLElement>,
  onActivate: () => void,
) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onActivate();
  }
}

function getBookMonogram(title: string): string {
  const letters = title
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
  return letters || "BK";
}

function getToneClasses(seed: string) {
  const tones = [
    "from-emerald-800 via-emerald-700 to-teal-600",
    "from-slate-800 via-slate-700 to-emerald-700",
    "from-teal-800 via-cyan-700 to-emerald-600",
    "from-green-900 via-emerald-700 to-lime-600",
    "from-zinc-800 via-emerald-800 to-teal-700",
  ] as const;
  const hash = Array.from(seed).reduce((a, c) => a + c.charCodeAt(0), 0);
  return tones[hash % tones.length];
}

function getAvailabilityClasses(
  tone: CatalogBookCardProps["availabilityTone"],
) {
  if (tone === "available")
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tone === "borrowed") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

export default function CatalogBookCard({
  title,
  subtitle,
  authorLine,
  coverImageUrl,
  availabilityLabel,
  availabilityTone,
  metaItems,
  actionLabel,
  actionDisabled,
  hasBorrowedBefore,
  onOpenDetails,
  onAction,
  actionVariant = "primary",
  headerAccessory,
}: CatalogBookCardProps) {
  const toneClasses = getToneClasses(title);
  const actionClasses =
    actionVariant === "primary"
      ? "bg-emerald-700 text-white hover:bg-emerald-800"
      : "border border-slate-200 bg-slate-50 text-slate-700 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700";

  return (
    <article
      className="group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white shadow-[0_16px_36px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-[0_22px_44px_rgba(15,23,42,0.11)]"
      role="button"
      tabIndex={0}
      onClick={onOpenDetails}
      onKeyDown={(e) => onCardKeyDown(e, onOpenDetails)}
    >
      {/* Cover — overlay gradient removed for crisp, sharp jacket display */}
      <div
        className={`relative h-48 overflow-hidden bg-gradient-to-br ${toneClasses}`}
      >
        {coverImageUrl ? (
          <img
            src={coverImageUrl}
            alt={`${title} cover`}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-3xl font-semibold tracking-[0.24em] text-white/90">
            {getBookMonogram(title)}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-3.5">
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-sm font-semibold tracking-tight text-slate-900">
              {title}
            </h3>
            <p className="mt-1 line-clamp-2 text-xs leading-[1.15rem] text-slate-500">
              {subtitle}
            </p>
          </div>
          {headerAccessory ?? (
            <span
              className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${getAvailabilityClasses(availabilityTone)}`}
            >
              {availabilityLabel}
            </span>
          )}
        </div>

        <p className="line-clamp-2 text-xs leading-[1.15rem] text-slate-600">
          {authorLine}
        </p>

        {hasBorrowedBefore ? (
          <span className="w-fit rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
            Borrowed before
          </span>
        ) : null}

        <ul className="space-y-1 text-[11px] leading-[1.15rem] text-slate-500">
          {metaItems.map((item, index) => (
            <li key={`${item}-${index}`} className="line-clamp-1">
              {item}
            </li>
          ))}
        </ul>

        <button
          type="button"
          className={`mt-auto rounded-xl px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-55 ${actionClasses}`}
          disabled={actionDisabled}
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            onAction();
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {actionLabel}
        </button>
      </div>
    </article>
  );
}
