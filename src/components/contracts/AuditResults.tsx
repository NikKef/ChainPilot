'use client';

import { motion } from 'framer-motion';
import { 
  Shield, 
  AlertTriangle, 
  AlertCircle, 
  Info, 
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink
} from 'lucide-react';
import { useState } from 'react';
import { Card, Badge } from '@/components/ui';
import type { AuditResult, AuditFinding, RiskLevel } from '@/lib/types';
import { getRiskLevelVariant, getSeverityColor } from '@/lib/types/contract';
import { cn } from '@/lib/utils';

interface AuditResultsProps {
  audit: AuditResult;
  className?: string;
}

const severityIcons: Record<AuditFinding['severity'], React.ElementType> = {
  critical: AlertCircle,
  high: AlertTriangle,
  medium: AlertTriangle,
  low: Info,
  informational: Info,
};

const severityColors: Record<AuditFinding['severity'], string> = {
  critical: 'text-risk-blocked bg-risk-blocked/10',
  high: 'text-risk-high bg-risk-high/10',
  medium: 'text-risk-medium bg-risk-medium/10',
  low: 'text-accent-amber bg-accent-amber/10',
  informational: 'text-foreground-muted bg-background-tertiary',
};

export function AuditResults({ audit, className }: AuditResultsProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['major']));

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const allFindings = [
    ...audit.majorFindings,
    ...audit.mediumFindings,
    ...audit.minorFindings,
  ];

  const totalFindings = allFindings.length;

  return (
    <Card className={className}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-10 h-10 rounded-lg flex items-center justify-center',
            audit.riskLevel === 'LOW' && 'bg-risk-low/20',
            audit.riskLevel === 'MEDIUM' && 'bg-risk-medium/20',
            audit.riskLevel === 'HIGH' && 'bg-risk-high/20',
            audit.riskLevel === 'BLOCKED' && 'bg-risk-blocked/20',
          )}>
            <Shield className={cn(
              'w-5 h-5',
              audit.riskLevel === 'LOW' && 'text-risk-low',
              audit.riskLevel === 'MEDIUM' && 'text-risk-medium',
              audit.riskLevel === 'HIGH' && 'text-risk-high',
              audit.riskLevel === 'BLOCKED' && 'text-risk-blocked',
            )} />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Audit Results</h2>
            <p className="text-sm text-foreground-muted">
              {totalFindings} finding{totalFindings !== 1 ? 's' : ''} detected
            </p>
          </div>
        </div>
        <Badge variant={getRiskLevelVariant(audit.riskLevel)} className="text-sm px-3 py-1">
          {audit.riskLevel} RISK
        </Badge>
      </div>

      {/* Summary */}
      <div className="p-4 bg-background rounded-xl mb-6">
        <p className="text-sm">{audit.summary}</p>
      </div>

      {/* Findings */}
      <div className="space-y-4">
        {/* Major Findings */}
        {audit.majorFindings.length > 0 && (
          <FindingsSection
            title="Major Findings"
            findings={audit.majorFindings}
            isExpanded={expandedSections.has('major')}
            onToggle={() => toggleSection('major')}
            badgeColor="high"
          />
        )}

        {/* Medium Findings */}
        {audit.mediumFindings.length > 0 && (
          <FindingsSection
            title="Medium Findings"
            findings={audit.mediumFindings}
            isExpanded={expandedSections.has('medium')}
            onToggle={() => toggleSection('medium')}
            badgeColor="medium"
          />
        )}

        {/* Minor Findings */}
        {audit.minorFindings.length > 0 && (
          <FindingsSection
            title="Minor Findings"
            findings={audit.minorFindings}
            isExpanded={expandedSections.has('minor')}
            onToggle={() => toggleSection('minor')}
            badgeColor="low"
          />
        )}

        {/* No findings */}
        {totalFindings === 0 && (
          <div className="flex items-center gap-3 p-4 bg-risk-low/10 rounded-xl">
            <CheckCircle className="w-5 h-5 text-risk-low" />
            <span className="text-sm">No security issues detected</span>
          </div>
        )}
      </div>

      {/* Recommendations */}
      {audit.recommendations.length > 0 && (
        <div className="mt-6 pt-6 border-t border-border">
          <h3 className="text-sm font-semibold mb-3">Recommendations</h3>
          <ul className="space-y-2">
            {audit.recommendations.map((rec, index) => (
              <motion.li
                key={index}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className="flex items-start gap-2 text-sm"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                <span className="text-foreground-muted">{rec}</span>
              </motion.li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

interface FindingsSectionProps {
  title: string;
  findings: AuditFinding[];
  isExpanded: boolean;
  onToggle: () => void;
  badgeColor: 'high' | 'medium' | 'low';
}

function FindingsSection({ 
  title, 
  findings, 
  isExpanded, 
  onToggle, 
  badgeColor 
}: FindingsSectionProps) {
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-background-tertiary transition-colors"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-foreground-muted" />
          ) : (
            <ChevronRight className="w-4 h-4 text-foreground-muted" />
          )}
          <span className="font-medium">{title}</span>
          <Badge variant={badgeColor}>{findings.length}</Badge>
        </div>
      </button>

      {isExpanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="border-t border-border"
        >
          <div className="divide-y divide-border">
            {findings.map((finding, index) => (
              <FindingItem key={index} finding={finding} />
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

function FindingItem({ finding }: { finding: AuditFinding }) {
  const Icon = severityIcons[finding.severity];

  return (
    <div className="p-4">
      <div className="flex items-start gap-3">
        <div className={cn('p-1.5 rounded', severityColors[finding.severity])}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm mb-1">{finding.title}</h4>
          <p className="text-sm text-foreground-muted mb-2">{finding.description}</p>
          
          {finding.location && (
            <div className="text-xs text-foreground-subtle mb-2">
              Location: <code className="px-1 bg-background-tertiary rounded">{finding.location}</code>
            </div>
          )}
          
          {finding.recommendation && (
            <div className="mt-2 p-2 bg-background rounded-lg">
              <span className="text-xs font-medium text-accent-emerald">Recommendation: </span>
              <span className="text-xs text-foreground-muted">{finding.recommendation}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

