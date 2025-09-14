import * as LucideIcons from 'lucide-react';

export default function Icon({
  name,
  size = 24,
  strokeWidth = 2,
  variant = 'mono',
  className,
  ...props
}) {
  const IconComponent = LucideIcons[name];
  if (!IconComponent) return null;

  const style = { color: 'var(--icon)' };
  if (variant === 'duo') {
    style.fill = 'var(--accent)';
  } else {
    style.fill = 'none';
  }

  return (
    <IconComponent
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      style={style}
      aria-hidden="true"
      {...props}
    />
  );
}

