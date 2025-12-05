'use client';

import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle, ShieldAlert, ShieldX, Info } from 'lucide-react';
import { Card, Badge } from '@/components/ui';
import type { PolicyEvaluationResult, RiskLevel } from '@/lib/types';
import { RISK_LEVEL_DESCRIPTIONS, getRiskLevelVariant } from '@/lib/types/policy';
import { cn } from '@/lib/utils';

interface RiskPanelProps {
  decision: PolicyEvaluationResult;
  className?: string;
}

const riskIcons: Record<RiskLevel, React.ElementType> = {
  LOW: CheckCircle,
  MEDIUM: AlertTriangle,
  HIGH: ShieldAlert,
  BLOCKED: ShieldX,
};

const riskColors: Record<RiskLevel, string> = {
  LOW: 'text-risk-low',
  MEDIUM: 'text-risk-medium',
  HIGH: 'text-risk-high',
  BLOCKED: 'text-risk-blocked',
};

export function RiskPanel({ decision, className }: RiskPanelProps) {
  const RiskIcon = riskIcons[decision.riskLevel];

  return (
    <Card className={cn('', className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <RiskIcon className={cn('w-5 h-5', riskColors[decision.riskLevel])} />
          <h3 className="font-semibold">Risk Assessment</h3>
        </div>
        <Badge variant={getRiskLevelVariant(decision.riskLevel)}>
          {decision.riskLevel} RISK
        </Badge>
      </div>

      {/* Description */}
      <p className="text-sm text-foreground-muted mb-4">
        {RISK_LEVEL_DESCRIPTIONS[decision.riskLevel]}
      </p>

      {/* Violations */}
      {decision.violations.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-medium text-risk-high mb-2 flex items-center gap-2">
            <ShieldX className="w-4 h-4" />
            Policy Violations
          </h4>
          <ul className="space-y-2">
            {decision.violations.map((violation, index) => (
              <motion.li
                key={index}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className="flex items-start gap-2 text-sm"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-risk-high mt-2 shrink-0" />
                <span className="text-foreground-muted">{violation.message}</span>
              </motion.li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {decision.warnings.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-medium text-risk-medium mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Warnings
          </h4>
          <ul className="space-y-2">
            {decision.warnings.map((warning, index) => (
              <motion.li
                key={index}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className="flex items-start gap-2 text-sm"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-risk-medium mt-2 shrink-0" />
                <span className="text-foreground-muted">{warning.message}</span>
              </motion.li>
            ))}
          </ul>
        </div>
      )}

      {/* All clear message */}
      {decision.violations.length === 0 && decision.warnings.length === 0 && (
        <div className="flex items-center gap-2 text-risk-low text-sm">
          <CheckCircle className="w-4 h-4" />
          <span>All policy checks passed</span>
        </div>
      )}

      {/* Status */}
      <div className="mt-4 pt-4 border-t border-border">
        <div className="flex items-center justify-between text-sm">
          <span className="text-foreground-muted">Transaction Status</span>
          <span className={cn(
            'font-medium',
            decision.allowed ? 'text-risk-low' : 'text-risk-blocked'
          )}>
            {decision.allowed ? 'Allowed' : 'Blocked'}
          </span>
        </div>
      </div>
    </Card>
  );
}

