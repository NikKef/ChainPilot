'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-primary/20 text-primary',
        secondary: 'bg-background-tertiary text-foreground-muted',
        success: 'bg-accent-emerald/20 text-accent-emerald',
        warning: 'bg-accent-amber/20 text-accent-amber',
        danger: 'bg-risk-high/20 text-risk-high',
        info: 'bg-accent-cyan/20 text-accent-cyan',
        // Risk levels
        low: 'bg-risk-low/20 text-risk-low',
        medium: 'bg-risk-medium/20 text-risk-medium',
        high: 'bg-risk-high/20 text-risk-high',
        blocked: 'bg-risk-blocked/20 text-risk-blocked',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };

