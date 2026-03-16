import { ReactNode } from "react";

type SummaryMetric = {
  label: string;
  value: ReactNode;
};

type PortalSummaryStripProps = {
  ariaLabel: string;
  metrics: SummaryMetric[];
  className?: string;
};

export default function PortalSummaryStrip({
  ariaLabel,
  metrics,
  className
}: PortalSummaryStripProps) {
  const classes = ["reservation-summary-strip", className].filter(Boolean).join(" ");

  return (
    <section className={classes} aria-label={ariaLabel}>
      {metrics.map((metric) => (
        <article key={metric.label} className="summary-card">
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </article>
      ))}
    </section>
  );
}
