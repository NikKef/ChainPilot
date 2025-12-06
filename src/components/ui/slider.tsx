'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onChangeEnd?: (value: number) => void;
  formatLabel?: (value: number) => string;
  showMinMax?: boolean;
  minLabel?: string;
  maxLabel?: string;
  disabled?: boolean;
  className?: string;
  trackClassName?: string;
  thumbClassName?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  onChangeEnd,
  formatLabel,
  showMinMax = true,
  minLabel,
  maxLabel,
  disabled = false,
  className,
  trackClassName,
  thumbClassName,
  variant = 'default',
}: SliderProps) {
  const [localValue, setLocalValue] = useState(value);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  // Sync external value changes when not dragging
  useEffect(() => {
    if (!isDragging) {
      setLocalValue(value);
    }
  }, [value, isDragging]);

  const percentage = ((localValue - min) / (max - min)) * 100;

  const getValueFromPosition = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return localValue;

      const rect = trackRef.current.getBoundingClientRect();
      const position = (clientX - rect.left) / rect.width;
      const rawValue = min + position * (max - min);

      // Round to step
      const steppedValue = Math.round(rawValue / step) * step;

      // Clamp to range
      return Math.max(min, Math.min(max, steppedValue));
    },
    [min, max, step, localValue]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;

      e.preventDefault();
      setIsDragging(true);

      const newValue = getValueFromPosition(e.clientX);
      setLocalValue(newValue);
      onChange(newValue);

      // Capture pointer for smooth dragging
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [disabled, getValueFromPosition, onChange]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging || disabled) return;

      const newValue = getValueFromPosition(e.clientX);
      setLocalValue(newValue);
      onChange(newValue);
    },
    [isDragging, disabled, getValueFromPosition, onChange]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;

      setIsDragging(false);
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);

      // Fire the final value change
      if (onChangeEnd) {
        onChangeEnd(localValue);
      }
    },
    [isDragging, localValue, onChangeEnd]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;

      let newValue = localValue;

      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          newValue = Math.min(max, localValue + step);
          break;
        case 'ArrowLeft':
        case 'ArrowDown':
          newValue = Math.max(min, localValue - step);
          break;
        case 'Home':
          newValue = min;
          break;
        case 'End':
          newValue = max;
          break;
        default:
          return;
      }

      e.preventDefault();
      setLocalValue(newValue);
      onChange(newValue);
      onChangeEnd?.(newValue);
    },
    [disabled, localValue, min, max, step, onChange, onChangeEnd]
  );

  const variantStyles = {
    default: {
      track: 'bg-primary',
      thumb: 'border-primary bg-white shadow-primary/20',
    },
    success: {
      track: 'bg-accent-emerald',
      thumb: 'border-accent-emerald bg-white shadow-accent-emerald/20',
    },
    warning: {
      track: 'bg-accent-amber',
      thumb: 'border-accent-amber bg-white shadow-accent-amber/20',
    },
    danger: {
      track: 'bg-accent-red',
      thumb: 'border-accent-red bg-white shadow-accent-red/20',
    },
  };

  const styles = variantStyles[variant];

  return (
    <div className={cn('w-full', className)}>
      {/* Track Container */}
      <div
        ref={trackRef}
        className={cn(
          'relative h-8 flex items-center cursor-pointer touch-none select-none',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        role="slider"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={localValue}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleKeyDown}
      >
        {/* Background Track */}
        <div
          className={cn(
            'absolute w-full h-2 rounded-full bg-border/60',
            trackClassName
          )}
        />

        {/* Filled Track */}
        <motion.div
          className={cn('absolute h-2 rounded-full', styles.track)}
          style={{ width: `${percentage}%` }}
          layout
          transition={{ type: 'spring', stiffness: 400, damping: 40 }}
        />

        {/* Thumb */}
        <motion.div
          className={cn(
            'absolute w-5 h-5 rounded-full border-2',
            'transform -translate-x-1/2',
            'shadow-lg transition-shadow duration-150',
            styles.thumb,
            thumbClassName,
            (isDragging || isHovering) && 'shadow-xl scale-110'
          )}
          style={{ left: `${percentage}%` }}
          animate={{
            scale: isDragging ? 1.15 : isHovering ? 1.1 : 1,
          }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        />

        {/* Value Tooltip */}
        {(isDragging || isHovering) && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            className={cn(
              'absolute -top-8 px-2 py-0.5 rounded-md',
              'text-xs font-medium text-white',
              'transform -translate-x-1/2 pointer-events-none',
              variant === 'default' && 'bg-primary',
              variant === 'success' && 'bg-accent-emerald',
              variant === 'warning' && 'bg-accent-amber',
              variant === 'danger' && 'bg-accent-red'
            )}
            style={{ left: `${percentage}%` }}
          >
            {formatLabel ? formatLabel(localValue) : localValue}
          </motion.div>
        )}
      </div>

      {/* Min/Max Labels */}
      {showMinMax && (
        <div className="flex justify-between mt-1 text-xs text-foreground-subtle">
          <span>{minLabel ?? min}</span>
          <span>{maxLabel ?? max}</span>
        </div>
      )}
    </div>
  );
}

