import { ArrowUpRight } from 'lucide-react';
import { SITE } from '@/lib/site';

type Props = {
  variant?: 'primary' | 'secondary';
  size?: 'md' | 'lg';
  label?: string;
  className?: string;
};

/** The one conversion action on the site: opens the waitlist Google Form in a new tab. */
export function WaitlistLink({ variant = 'primary', size = 'md', label = 'Join the waitlist', className = '' }: Props) {
  return (
    <a
      href={SITE.waitlistUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`sx-btn sx-btn--${variant}${size === 'lg' ? ' ws-btn-lg' : ''} ${className}`.trim()}
    >
      {label}
      <ArrowUpRight className="sx-icon" aria-hidden="true" />
      <span className="sr-only"> (opens Google Forms in a new tab)</span>
    </a>
  );
}
