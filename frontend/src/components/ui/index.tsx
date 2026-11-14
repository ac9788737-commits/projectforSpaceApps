// Components follow the shadcn/ui patterns (cva variants + tailwind-merge).
import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlert, CircleCheck, CircleX } from "lucide-react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-ink hover:opacity-90",
        outline: "border border-line bg-surface hover:bg-surface-2",
        ghost: "hover:bg-surface-2",
      },
      size: { default: "h-9 px-4", sm: "h-8 px-3" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface p-5", className)} {...props} />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-base font-semibold mb-3", className)} {...props} />;
}

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border border-line",
  {
    variants: {
      tone: {
        neutral: "bg-surface-2 text-ink-2",
        accent: "text-accent",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

const STATUS = {
  ok: { label: "норма", Icon: CircleCheck, className: "text-good" },
  stress: { label: "стресс", Icon: CircleAlert, className: "text-warn" },
  lethal: { label: "летально", Icon: CircleX, className: "text-crit" },
} as const;

export function StatusLabel({ status }: { status: keyof typeof STATUS }) {
  const { label, Icon, className } = STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm", className)}>
      <Icon size={15} aria-hidden /> {label}
    </span>
  );
}

const fieldClass =
  "h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-3";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldClass, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(fieldClass, className)} {...props} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md border border-line bg-surface p-3 text-sm",
        tone === "error" ? "text-crit" : "text-ink-2",
      )}
    >
      {children}
    </div>
  );
}
