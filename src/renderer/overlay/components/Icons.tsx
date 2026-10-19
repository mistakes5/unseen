import React from 'react';

// 16px stroke icons drawn on a 16-unit grid; colour follows currentColor.
function Icon({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg className="icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const EyeIcon = (): React.JSX.Element => (
  <Icon><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="2" /></Icon>
);
export const EyeOffIcon = (): React.JSX.Element => (
  <Icon><path d="M6.2 3.8A6.6 6.6 0 0 1 8 3.5c4.1 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.8 2.3M4.3 4.8A11.2 11.2 0 0 0 1.5 8s2.4 4.5 6.5 4.5c1.1 0 2.1-.3 2.9-.8" /><path d="M2 2l12 12" /></Icon>
);
export const MinusIcon = (): React.JSX.Element => <Icon><path d="M3.5 8h9" /></Icon>;
export const GearIcon = (): React.JSX.Element => (
  <Icon><circle cx="8" cy="8" r="2.1" /><path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6" /></Icon>
);
export const CloseIcon = (): React.JSX.Element => <Icon><path d="M4 4l8 8M12 4l-8 8" /></Icon>;
export const PlayIcon = (): React.JSX.Element => (
  <Icon><path d="M5 3.2v9.6L12.6 8 5 3.2Z" fill="currentColor" stroke="none" /></Icon>
);
export const StopIcon = (): React.JSX.Element => (
  <Icon><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" /></Icon>
);
export const PauseIcon = (): React.JSX.Element => <Icon><path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth="2" /></Icon>;
export const ChevronIcon = (): React.JSX.Element => <Icon><path d="M4.5 6.5 8 10l3.5-3.5" /></Icon>;
