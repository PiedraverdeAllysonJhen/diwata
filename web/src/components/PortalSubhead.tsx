import { ReactNode } from "react";

type PortalSubheadProps = {
  releaseCode: string;
  title: string;
  description: string;
  actions?: ReactNode;
  className?: string;
};

export default function PortalSubhead({
  releaseCode,
  title,
  description,
  actions,
  className
}: PortalSubheadProps) {
  const classes = ["portal-subhead", className].filter(Boolean).join(" ");

  return (
    <section className={classes}>
      <div>
        <p className="eyebrow">{releaseCode}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="portal-hero-actions">{actions}</div> : null}
    </section>
  );
}
